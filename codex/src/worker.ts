import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  claimNextJob,
  getOrgCredentialRaw,
  heartbeat,
  markCompleted,
  markFailed,
  requeueStaleJobs,
  resolveAnthropic,
  sql,
  updateProgress,
  type PendingCodeJob,
  type Project,
} from './db.ts'
import { prepareJobWorkspace } from './clone.ts'
import { decryptSecret } from './crypto.ts'
import { importManifest } from './import.ts'
import { runClaude } from './run-claude.ts'
import { env } from './env.ts'

const WORKER_ID = `codex-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
const POLL_INTERVAL_MS = Number(env('CODEX_POLL_MS', '2000'))
const STALE_TIMEOUT_SECONDS = Number(env('CODEX_STALE_SECONDS', '900'))
const HEARTBEAT_MS = 15_000
// Teto de custo por rodada (USD). Claude Code aborta quando atinge.
// Default conservador; ajuste via env do compose conforme necessário.
const MAX_BUDGET_USD = Number(env('CODEX_MAX_BUDGET_USD', '5'))
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
  console.log(`[codex] job=${jobId} project=${project.slug} starting`)

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
    await updateProgress(jobId, { label: 'preparando workspace' })
    const workspace = await prepareJobWorkspace(jobId, project)
    jobRoot = workspace.jobRoot

    await updateProgress(jobId, { label: 'resolvendo credencial Anthropic' })
    const cred = await getOrgCredentialRaw(project.org_id)
    const resolved = resolveAnthropic(cred, DEFAULT_MODEL)
    if (!resolved) {
      throw new Error(
        'credencial Anthropic não configurada para a org (configure em /settings/ai, bloco Análise de código)',
      )
    }
    const apiKey = decryptSecret(resolved.apiKeyEncrypted)
    const model = resolved.model
    console.log(
      `[codex] job=${jobId} credential source=${resolved.source} model=${model}`,
    )

    await updateProgress(jobId, { label: 'invocando Claude Code' })
    const result = await runClaude({
      input: {
        projectName: project.name,
        targetLocale: project.target_locale,
        jobRoot: workspace.jobRoot,
        outputDir: workspace.outputDir,
        repoRoot: workspace.repoRoot,
      },
      repoRoot: workspace.repoRoot,
      outputDir: workspace.outputDir,
      apiKey,
      model,
      maxBudgetUsd: MAX_BUDGET_USD,
      onEvent: async (evt) => {
        // Atualiza label só em eventos "interessantes" (tool-use),
        // evitando flood em text chunks.
        if (evt.toolName) {
          await updateProgress(jobId, {
            label: `claude: ${evt.toolName}`,
            incrementCompleted: true,
          })
        }
      },
    })

    tokensIn = result.tokensIn
    tokensOut = result.tokensOut
    turnsUsed = result.turnsUsed

    const outputInventory = await listOutputTree(workspace.outputDir)

    if (result.exitCode !== 0 || result.isError) {
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
        // Último recurso: tail do stdout bruto pra ver se o agente deu
        // pista do que aconteceu.
        parts.push(`stdoutTail: ${result.rawStdoutTail.slice(-400)}`)
      }
      throw new Error(parts.join(' | '))
    }

    await updateProgress(jobId, { label: 'importando manifest' })
    const { analysisId, manifestPath } = await importManifest({
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
      `[codex] job=${jobId} analysis=${analysisId} manifest=${manifestPath}`,
    )

    await markCompleted(jobId, { tokensIn, tokensOut, turnsUsed })
  } catch (err) {
    const msg = (err as Error).message
    console.error(`[codex] job=${jobId} FAILED:`, msg)
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
