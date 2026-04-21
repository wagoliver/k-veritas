import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  claimNextJob,
  emitEvent,
  getOrgCredentialRaw,
  heartbeat,
  markCompleted,
  markCompletedWithWarning,
  markFailed,
  requeueStaleJobs,
  resolveAnthropic,
  sql,
  updateProgress,
  type PendingCodeJob,
  type Project,
} from './db.ts'
import { persistRepoSnapshot, prepareJobWorkspace } from './clone.ts'
import { decryptSecret } from './crypto.ts'
import { importManifest } from './import.ts'
import { importStructureManifest } from './import-structure.ts'
import { runClaude } from './run-claude.ts'
import { env } from './env.ts'

const WORKER_ID = `codex-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
const POLL_INTERVAL_MS = Number(env('CODEX_POLL_MS', '2000'))
const STALE_TIMEOUT_SECONDS = Number(env('CODEX_STALE_SECONDS', '900'))
const HEARTBEAT_MS = 15_000
// Teto de custo por rodada (USD). Claude Code aborta quando atinge.
// Default conservador; ajuste via env do compose conforme necessário.
const MAX_BUDGET_USD = Number(env('CODEX_MAX_BUDGET_USD', '5'))
// Budget específico da fase 'structure' (inventário). Bem menor que o
// budget da fase 'tests' — só lista rotas, não explora código.
const STRUCTURE_BUDGET_USD = Number(env('CODEX_STRUCTURE_BUDGET_USD', '1'))
const DEFAULT_MODEL = env('CODEX_MODEL', 'claude-sonnet-4-5-20250929')
const KEEP_WORKDIR = env('CODEX_KEEP_WORKDIR', 'false') === 'true'

let stopping = false
process.on('SIGTERM', () => (stopping = true))
process.on('SIGINT', () => (stopping = true))

export async function runWorkerLoop(): Promise<void> {
  console.log(`[codex] ${WORKER_ID} starting`)
  let lastRequeueAt = 0

  while (!stopping) {
    try {
      const now = Date.now()
      if (now - lastRequeueAt > 60_000) {
        const n = await requeueStaleJobs(STALE_TIMEOUT_SECONDS)
        if (n > 0) console.log(`[codex] requeued ${n} stale job(s)`)
        lastRequeueAt = now
      }

      const next = await claimNextJob(WORKER_ID)
      if (!next) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }
      await processJob(next.job, next.project)
    } catch (err) {
      console.error('[codex] loop error:', (err as Error).message)
      await sleep(POLL_INTERVAL_MS)
    }
  }

  console.log(`[codex] ${WORKER_ID} shutting down`)
  await sql.end({ timeout: 5 })
}

async function processJob(
  job: PendingCodeJob,
  project: Project,
): Promise<void> {
  const jobId = job.id
  const phase = job.phase
  console.log(
    `[codex] job=${jobId} project=${project.slug} phase=${phase} starting`,
  )

  const hb = setInterval(() => {
    heartbeat(jobId, WORKER_ID).catch((e) =>
      console.error('[codex] heartbeat err:', (e as Error).message),
    )
  }, HEARTBEAT_MS)

  const t0 = Date.now()
  let tokensIn = 0
  let tokensOut = 0
  let turnsUsed = 0
  let jobRoot: string | null = null

  try {
    if (phase === 'tests') {
      throw new Error(
        'phase "tests" ainda não é executada pelo codex — use POST /features/[featureId]/generate-tests (fase 4 do roadmap)',
      )
    }

    await emitEvent(
      jobId,
      'status',
      'job_started',
      `worker=${WORKER_ID} project=${project.slug} phase=${phase}`,
    )
    await updateProgress(jobId, { label: 'preparando workspace' })
    await emitEvent(
      jobId,
      'status',
      'clone_start',
      project.source_type === 'repo' && project.repo_url
        ? `${project.repo_url} (${project.repo_branch ?? 'main'})`
        : project.repo_zip_path ?? '',
    )
    const workspace = await prepareJobWorkspace(jobId, project, phase)
    jobRoot = workspace.jobRoot
    await emitEvent(jobId, 'status', 'clone_done', workspace.repoRoot)

    await updateProgress(jobId, { label: 'resolvendo credencial Anthropic' })
    const cred = await getOrgCredentialRaw(project.org_id)
    const resolved = resolveAnthropic(cred, DEFAULT_MODEL)
    if (!resolved) {
      throw new Error(
        'credencial Anthropic não configurada para a org (configure em /settings/ai, bloco Análise de código)',
      )
    }
    const credential = decryptSecret(resolved.credentialEncrypted)
    // Override por job (QA escolheu um modelo no clique) tem precedência
    // sobre o anthropic_model da org. Ambos podem vir null e aí usa o
    // CODEX_MODEL do env.
    const model = job.model_override ?? resolved.model
    console.log(
      `[codex] job=${jobId} credential source=${resolved.source} authMode=${resolved.authMode} model=${model}${job.model_override ? ' (override)' : ''}`,
    )
    await emitEvent(
      jobId,
      'status',
      'claude_started',
      `model=${model} authMode=${resolved.authMode} phase=${phase}`,
    )

    const budget =
      phase === 'structure' ? STRUCTURE_BUDGET_USD : MAX_BUDGET_USD

    await updateProgress(jobId, { label: 'invocando Claude Code' })
    const result = await runClaude({
      input: {
        projectName: project.name,
        targetLocale: project.target_locale,
        jobRoot: workspace.jobRoot,
        outputDir: workspace.outputDir,
        repoRoot: workspace.repoRoot,
        phase,
      },
      repoRoot: workspace.repoRoot,
      outputDir: workspace.outputDir,
      credential,
      authMode: resolved.authMode,
      model,
      maxBudgetUsd: budget,
      phase,
      onEvent: async (evt) => {
        // Cada tool_use vira um evento visível no feed. Extrai um
        // preview útil do input pra mostrar contexto (caminho do
        // Read, pattern do Grep, etc.).
        if (evt.toolName) {
          const detail = extractToolDetail(evt.raw)
          await emitEvent(jobId, 'tool', evt.toolName, detail)
          await updateProgress(jobId, {
            label: detail
              ? `${evt.toolName}: ${detail.slice(0, 80)}`
              : `claude: ${evt.toolName}`,
            incrementCompleted: true,
          })
        }
      },
    })

    tokensIn = result.tokensIn
    tokensOut = result.tokensOut
    turnsUsed = result.turnsUsed

    const outputInventory = await listOutputTree(workspace.outputDir)
    const expectedOutput =
      phase === 'structure' ? 'features.json' : 'manifest.json'
    const hasManifest = outputInventory.some((p) =>
      p.startsWith(expectedOutput),
    )

    // Resumo textual do erro do Claude (se houver) — reusado pra
    // fail puro OU pra warning em modo best-effort.
    const claudeErrored = result.exitCode !== 0 || result.isError
    const errorSummary = buildErrorSummary(result, outputInventory)

    if (claudeErrored && !hasManifest) {
      await emitEvent(
        jobId,
        'error',
        'claude_failed',
        errorSummary.slice(0, 600),
      )
      throw new Error(errorSummary)
    }

    if (claudeErrored && hasManifest) {
      // Best-effort: o Claude bateu em algum limite (rate limit, budget,
      // erro de rede) MAS chegou a escrever o manifest. Importa assim
      // mesmo; o job fica "completed" com warning no final.
      console.warn(
        `[codex] job=${jobId} PARTIAL_SUCCESS (claude exit=${result.exitCode} is_error=${result.isError}) — importando ${expectedOutput} existente`,
      )
      await emitEvent(
        jobId,
        'error',
        'partial_success',
        `${result.errorMessage?.slice(0, 400) ?? 'erro intermediário'} — ${expectedOutput} parcial será importado`,
      )
    }

    await updateProgress(jobId, { label: `importando ${expectedOutput}` })
    const { analysisId, manifestPath } =
      phase === 'structure'
        ? await importStructureManifest({
            jobId,
            projectId: project.id,
            requestedBy: job.requested_by,
            model,
            provider: 'anthropic',
            outputDir: workspace.outputDir,
            durationMs: Date.now() - t0,
            tokensIn,
            tokensOut,
          })
        : await importManifest({
            jobId,
            projectId: project.id,
            requestedBy: job.requested_by,
            model,
            provider: 'anthropic',
            outputDir: workspace.outputDir,
            durationMs: Date.now() - t0,
            tokensIn,
            tokensOut,
          })

    console.log(
      `[codex] job=${jobId} analysis=${analysisId} manifest=${manifestPath} phase=${phase}`,
    )
    await emitEvent(
      jobId,
      'status',
      'import_done',
      `analysis=${analysisId} tokens=${tokensIn}/${tokensOut} turns=${turnsUsed}`,
    )

    // Persiste snapshot enxuto do repo pra que o app (volume /data
    // compartilhado) consiga ler os componentes na hora de gerar testes.
    if (phase === 'structure') {
      try {
        const snapshotPath = await persistRepoSnapshot(
          project.id,
          workspace.repoRoot,
        )
        console.log(
          `[codex] job=${jobId} snapshot persisted at ${snapshotPath}`,
        )
        await emitEvent(jobId, 'status', 'snapshot_persisted', snapshotPath)
      } catch (snapErr) {
        // Snapshot é best-effort — falha não invalida o job, mas o
        // static-inspect do app vai cair no fallback sem código.
        console.error(
          `[codex] job=${jobId} snapshot failed:`,
          (snapErr as Error).message,
        )
        await emitEvent(
          jobId,
          'error',
          'snapshot_failed',
          (snapErr as Error).message.slice(0, 400),
        )
      }
    }

    // Completa o job. Se o Claude errou mas a gente importou mesmo
    // assim, anota o warning no campo error pra QA saber (status
    // continua 'completed' — os dados estão no banco e usáveis).
    if (claudeErrored) {
      await markCompletedWithWarning(jobId, errorSummary, {
        tokensIn,
        tokensOut,
        turnsUsed,
      })
      await emitEvent(jobId, 'status', 'completed_with_warning')
    } else {
      await markCompleted(jobId, { tokensIn, tokensOut, turnsUsed })
      await emitEvent(jobId, 'status', 'completed')
    }
  } catch (err) {
    const msg = (err as Error).message
    console.error(`[codex] job=${jobId} FAILED:`, msg)
    await emitEvent(jobId, 'status', 'failed', msg.slice(0, 600))
    await markFailed(jobId, msg, { tokensIn, tokensOut, turnsUsed })
  } finally {
    clearInterval(hb)
    if (jobRoot && !KEEP_WORKDIR) {
      await rm(jobRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Extrai um preview curto do input de uma tool_use do stream-json.
// Diferentes tools têm campos diferentes no input — pegamos o que
// fizer sentido por tipo. Retorna null quando nada é extraível.
function extractToolDetail(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const parsed = raw as Record<string, unknown>
  const message = parsed.message as
    | { content?: Array<Record<string, unknown>> }
    | undefined
  const blocks = message?.content ?? []
  for (const block of blocks) {
    if (block.type !== 'tool_use') continue
    const input = block.input as Record<string, unknown> | undefined
    if (!input) continue
    // Campos comuns que valem mostrar como contexto.
    for (const key of [
      'file_path',
      'path',
      'pattern',
      'query',
      'command',
      'glob',
    ]) {
      const value = input[key]
      if (typeof value === 'string' && value.length > 0) {
        return value
      }
    }
  }
  return undefined
}

// Monta a string de diagnóstico quando o Claude saiu com erro.
// Usada tanto em fail puro (sem manifest) quanto em warning (best-effort).
function buildErrorSummary(
  result: Awaited<ReturnType<typeof runClaude>>,
  outputInventory: string[],
): string {
  const parts: string[] = []
  parts.push(
    `claude exit=${result.exitCode} is_error=${result.isError}` +
      (result.errorSubtype ? ` subtype=${result.errorSubtype}` : ''),
  )
  if (result.errorMessage) {
    parts.push(`msg: ${result.errorMessage.slice(0, 600)}`)
  }
  if (result.systemNotices.length > 0) {
    parts.push(
      `notices: ${result.systemNotices.slice(-3).join(' | ').slice(0, 600)}`,
    )
  }
  if (result.stderr && result.stderr.trim().length > 0) {
    parts.push(`stderr: ${result.stderr.slice(-400)}`)
  }
  if (result.finalMessage) {
    parts.push(`finalMsg: ${result.finalMessage.slice(0, 300)}`)
  }
  if (outputInventory.length === 0) {
    parts.push('outputDir vazio — Claude não escreveu arquivos')
  } else {
    parts.push(`outputDir: ${outputInventory.join(', ')}`)
  }
  if (!result.errorMessage && !result.stderr) {
    parts.push(`stdoutTail: ${result.rawStdoutTail.slice(-400)}`)
  }
  return parts.join(' | ')
}

// Lista arquivos em output/ (profundidade 2) pra diagnóstico. Retorna
// caminhos relativos. Silenciosa — vazia em erro de FS.
async function listOutputTree(root: string): Promise<string[]> {
  const out: string[] = []
  try {
    const level1 = await readdir(root, { withFileTypes: true })
    for (const e1 of level1) {
      if (e1.isDirectory()) {
        try {
          const level2 = await readdir(join(root, e1.name))
          for (const name of level2) {
            const abs = join(root, e1.name, name)
            try {
              const s = await stat(abs)
              out.push(`${e1.name}/${name} (${s.size}b)`)
            } catch {
              out.push(`${e1.name}/${name}`)
            }
          }
        } catch {
          out.push(`${e1.name}/`)
        }
      } else {
        try {
          const s = await stat(join(root, e1.name))
          out.push(`${e1.name} (${s.size}b)`)
        } catch {
          out.push(e1.name)
        }
      }
    }
  } catch {
    // sem output — devolve vazio
  }
  return out
}
