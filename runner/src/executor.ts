import { mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

import {
  loadProjectTestEnvVars,
  updateRunProgress,
  type PendingExecJob,
  type Project,
  type ScenarioToRun,
  type ResultRow,
  type StepEvent,
} from './db.ts'
import { decryptSecret } from './crypto.ts'

// Prefixo usado pelo custom reporter pra marcar eventos parseáveis.
// Precisa bater com o reporter em pw-reporter.cjs.
const EVENT_PREFIX = '::KV_EVT::'

interface PlaywrightJsonReport {
  stats?: {
    expected?: number
    unexpected?: number
    skipped?: number
    flaky?: number
  }
  suites?: PwSuite[]
}

interface PwSuite {
  title: string
  suites?: PwSuite[]
  specs?: PwSpec[]
}

interface PwSpec {
  title: string
  tests?: PwTestCase[]
}

interface PwTestCase {
  status?: string
  results?: PwTestResult[]
}

interface PwTestResult {
  status?: string
  duration?: number
  error?: { message?: string; stack?: string }
  errors?: Array<{ message?: string; stack?: string }>
  stdout?: Array<{ text?: string }>
  attachments?: Array<{ name?: string; path?: string; contentType?: string }>
}

export interface ExecuteOptions {
  workDir: string         // scratchpad do runner (ex.: /work)
  dataDir: string         // /data compartilhado com app
  playwrightTimeoutMs: number   // total do test() inteiro
  actionTimeoutMs: number       // cada .click/.fill/etc
  navigationTimeoutMs: number   // goto + waitFor navigation
}

/**
 * Executa um cenário específico:
 *   1. Resolve credenciais (decifra auth_credentials quando authKind=form)
 *   2. Escreve playwright.config.ts e o .spec.ts reconstituído em /work/<runId>/
 *   3. Spawna `npx playwright test` com reporter=json
 *   4. Parse do JSON + extração de artefatos
 */
export async function executeScenarioJob(
  job: PendingExecJob,
  project: Project,
  scenario: ScenarioToRun,
  opts: ExecuteOptions,
): Promise<ResultRow[]> {
  const runDir = join(opts.workDir, job.id)
  const testsDir = join(runDir, 'tests')
  const reportPath = join(runDir, 'report.json')
  const artifactsDir = join(
    opts.dataDir,
    'projects',
    project.id,
    'exec',
    job.id,
  )

  try {
    await mkdir(testsDir, { recursive: true })
    await mkdir(artifactsDir, { recursive: true })

    // Playwright resolve @playwright/test subindo a árvore a partir do
    // config file. Symlink /work/<runId>/node_modules → /app/node_modules
    // deixa o runner carregar sem depender de NODE_PATH.
    await symlink('/app/node_modules', join(runDir, 'node_modules')).catch(
      (err) => {
        // EEXIST é benigno (symlink já criado em retry); demais propagam.
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      },
    )

    const { specFileName, specContent } = buildSpecFile(scenario)
    await writeFile(join(testsDir, specFileName), specContent, 'utf8')

    const config = buildPlaywrightConfig(
      project,
      artifactsDir,
      reportPath,
      opts,
    )
    await writeFile(join(runDir, 'playwright.config.ts'), config, 'utf8')

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PW_BASE_URL: project.target_url,
    }
    const creds = decryptAuthCreds(project)
    if (creds) {
      env.TEST_USERNAME = creds.username
      env.TEST_PASSWORD = creds.password
      if (creds.loginUrl) env.TEST_LOGIN_URL = creds.loginUrl
    }

    // Variáveis cadastradas pela QA na tela Setup. O código gerado usa
    // `process.env.E2E_USER` (etc.) — o valor vem daqui. Se a QA não
    // cadastrou, a env fica undefined e o teste falha com mensagem
    // explícita do Playwright (intencional).
    const projectVars = await loadProjectTestEnvVars(project.id)
    for (const v of projectVars) {
      env[v.name] = decryptSecret(v.valueEncrypted)
    }

    // Spawn + parse de eventos do reporter em streaming pra progresso live
    const exit = await spawnPlaywright(runDir, reportPath, env, job.id)

    const reportText = await readOptionalFile(reportPath)
    const parsed = reportText
      ? (JSON.parse(reportText) as PlaywrightJsonReport)
      : null

    const results = extractResults(parsed, scenario, exit.stdout, artifactsDir)
    // Cola os step events coletados em streaming no primeiro result.
    // Como o runner executa exatamente 1 cenário = 1 test() = 1 result,
    // essa associação é 1-to-1.
    if (results.length > 0 && exit.stepEvents.length > 0) {
      results[0].step_events = exit.stepEvents
    }
    return results
  } finally {
    // Limpa scratchpad; mantém artefatos em /data
    await rm(runDir, { recursive: true, force: true }).catch(() => {})
  }
}

function buildSpecFile(scenario: ScenarioToRun): {
  specFileName: string
  specContent: string
} {
  const specFileName = `scenario-${scenario.scenario_id}.spec.ts`

  // Modelo novo (codex): code é self-contained — já traz o import do
  // @playwright/test e o test() completo. Usa como está, sem wrapper.
  // Regex: `import { ... } from '@playwright/test'` — repara que `[^}]*`
  // para no `}` mas o regex antigo esqueceu esse fecha-chave antes do
  // `from`, então nunca matchava.
  const selfContained = /import\s*\{[^}]*\}\s*from\s*['"]@playwright\/test['"]/.test(
    scenario.code,
  )
  if (selfContained) {
    return { specFileName, specContent: `${scenario.code.trim()}\n` }
  }

  // Modelo antigo (runs pré-migração): code era snippet, precisava ser
  // embrulhado em test.describe(...) + import do header/footer guardados
  // em feature_test_files. Fallback defensivo pra dados legados.
  const header =
    scenario.file_header ||
    `import { test, expect } from '@playwright/test'\n\ntest.describe('${scenario.feature_external_id}', () => {\n`
  const footer = scenario.file_footer || '})'

  const indentedCode = scenario.code
    .split('\n')
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join('\n')

  const specContent = `${header}\n${indentedCode}\n${footer}\n`
  return { specFileName, specContent }
}

function buildPlaywrightConfig(
  project: Project,
  artifactsDir: string,
  reportPath: string,
  opts: ExecuteOptions,
): string {
  // Três timeouts separados — ajuda a localizar onde o teste trava:
  //   timeout: teto total do test() inteiro
  //   actionTimeout: teto por click/fill/check (falha rápido quando
  //     locator não aparece)
  //   navigationTimeout: teto pra goto() e waitForURL()
  return `import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: ${opts.playwrightTimeoutMs},
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['json', { outputFile: ${JSON.stringify(reportPath)} }],
    ['/app/src/pw-reporter.cjs'],
  ],
  outputDir: ${JSON.stringify(artifactsDir)},
  use: {
    baseURL: ${JSON.stringify(project.target_url)},
    actionTimeout: ${opts.actionTimeoutMs},
    navigationTimeout: ${opts.navigationTimeoutMs},
    trace: 'on',
    screenshot: { mode: 'on', fullPage: false },
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    headless: true,
    ignoreHTTPSErrors: true,
  },
})
`
}

function decryptAuthCreds(
  project: Project,
): { username: string; password: string; loginUrl: string | null } | null {
  if (project.auth_kind !== 'form' || !project.auth_credentials) return null
  try {
    const plaintext = decryptSecret(project.auth_credentials)
    const parsed = JSON.parse(plaintext) as {
      username?: string
      password?: string
      loginUrl?: string
    }
    if (!parsed.username || !parsed.password) return null
    return {
      username: parsed.username,
      password: parsed.password,
      loginUrl: parsed.loginUrl ?? null,
    }
  } catch (err) {
    console.error('[runner] failed to decrypt auth_credentials', err)
    return null
  }
}

async function spawnPlaywright(
  cwd: string,
  reportPath: string,
  env: NodeJS.ProcessEnv,
  jobId: string,
): Promise<{ stdout: string; exitCode: number; stepEvents: StepEvent[] }> {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['playwright', 'test', '--config=playwright.config.ts'],
      {
        cwd,
        env: {
          ...env,
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
          CI: '1',
        },
      },
    )

    let stdout = ''
    let stderr = ''
    let buffer = ''

    // Progresso live: conta steps top-level, atualiza DB throttled
    let stepsTotal = 0 // estimado; cresce conforme os steps aparecem
    let stepsCompleted = 0
    let currentLabel: string | null = null
    let currentLine: number | null = null
    let lastFlushAt = 0
    let pendingFlush = false
    const stepEvents: StepEvent[] = []
    const stepStartByIndex = new Map<number, string>()

    const flush = () => {
      lastFlushAt = Date.now()
      pendingFlush = false
      void updateRunProgress(jobId, {
        stepsCompleted,
        stepsTotal: Math.max(stepsTotal, stepsCompleted),
        currentStepLabel: currentLabel,
        currentStepLine: currentLine,
      }).catch(() => {
        // best-effort: progresso é melhor ter aproximado que não ter
      })
    }

    const scheduleFlush = () => {
      const now = Date.now()
      if (now - lastFlushAt >= 400) {
        flush()
      } else if (!pendingFlush) {
        pendingFlush = true
        setTimeout(() => {
          if (pendingFlush) flush()
        }, 400)
      }
    }

    const handleLine = (line: string) => {
      if (!line.startsWith(EVENT_PREFIX)) return
      try {
        const payload = JSON.parse(line.slice(EVENT_PREFIX.length)) as {
          type: string
          title?: string
          line?: number | null
          index?: number
          durationMs?: number | null
          status?: 'passed' | 'failed' | 'skipped'
          errorMessage?: string | null
          errorStack?: string | null
          startedAt?: string
          finishedAt?: string
        }
        switch (payload.type) {
          case 'step-begin':
            stepsTotal = Math.max(stepsTotal, payload.index ?? stepsTotal + 1)
            currentLabel = payload.title ?? null
            currentLine = payload.line ?? null
            if (typeof payload.index === 'number') {
              stepStartByIndex.set(
                payload.index,
                payload.startedAt ?? new Date().toISOString(),
              )
            }
            scheduleFlush()
            break
          case 'step-end':
            stepsCompleted += 1
            if (typeof payload.index === 'number') {
              const startedAt =
                stepStartByIndex.get(payload.index) ??
                payload.startedAt ??
                new Date().toISOString()
              stepStartByIndex.delete(payload.index)
              stepEvents.push({
                step_index: payload.index,
                title: payload.title ?? '',
                status: payload.status ?? 'passed',
                duration_ms: payload.durationMs ?? null,
                error_message: payload.errorMessage ?? null,
                error_stack: payload.errorStack ?? null,
                line_in_spec: payload.line ?? null,
                started_at: startedAt,
                finished_at:
                  payload.finishedAt ?? new Date().toISOString(),
              })
            }
            scheduleFlush()
            break
          case 'test-end':
            currentLabel = null
            scheduleFlush()
            break
        }
      } catch {
        // linha de evento corrompida: ignora
      }
    }

    const processChunk = (chunk: string) => {
      buffer += chunk
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        handleLine(line)
      }
    }

    child.stdout?.on('data', (chunk) => {
      const str = chunk.toString()
      stdout += str
      processChunk(str)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => {
      if (pendingFlush) flush()
      const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : '')
      resolve({
        stdout: combined.slice(-8_000),
        exitCode: code ?? 0,
        stepEvents,
      })
    })
    child.on('error', (err) => {
      resolve({
        stdout: `[spawn error] ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
        stepEvents,
      })
    })
  })
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises')
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function extractResults(
  report: PlaywrightJsonReport | null,
  scenario: ScenarioToRun,
  stdout: string,
  artifactsDir: string,
): ResultRow[] {
  if (!report) {
    // Reporter não gerou JSON — marca como falha, coloca o tail do stdout
    // dentro do errorMessage pra visibilidade imediata na UI.
    const tail = stdout.slice(-1200).trim()
    return [
      {
        scenario_id: scenario.scenario_id,
        title: scenario.title,
        status: 'failed',
        duration_ms: null,
        error_message:
          tail.length > 0
            ? `Playwright não gerou relatório JSON. Output:\n${tail}`
            : 'Playwright não gerou relatório JSON (sem output).',
        error_stack: null,
        stdout,
        trace_path: null,
        screenshot_path: null,
        step_events: [],
      },
    ]
  }

  const rows: ResultRow[] = []
  const walk = (suite: PwSuite) => {
    if (suite.specs) {
      for (const spec of suite.specs) {
        for (const testCase of spec.tests ?? []) {
          const lastResult =
            testCase.results?.[testCase.results.length - 1] ?? null
          rows.push(
            makeRow(scenario, spec.title, lastResult, stdout, artifactsDir),
          )
        }
      }
    }
    if (suite.suites) {
      for (const sub of suite.suites) walk(sub)
    }
  }
  for (const s of report.suites ?? []) walk(s)

  // Se por algum motivo não encontrou nenhum spec (ex: arquivo não carregou),
  // retorna uma falha sintética.
  if (rows.length === 0) {
    rows.push({
      scenario_id: scenario.scenario_id,
      title: scenario.title,
      status: 'failed',
      duration_ms: null,
      error_message: 'Nenhum resultado encontrado no relatório',
      error_stack: null,
      stdout,
      trace_path: null,
      screenshot_path: null,
      step_events: [],
    })
  }

  return rows
}

function makeRow(
  scenario: ScenarioToRun,
  specTitle: string,
  result: PwTestResult | null,
  stdout: string,
  artifactsDir: string,
): ResultRow {
  const status = mapStatus(result?.status)
  const errMsg =
    result?.error?.message ??
    result?.errors?.[0]?.message ??
    (status === 'passed' ? null : 'Sem detalhe de erro')
  const errStack = result?.error?.stack ?? result?.errors?.[0]?.stack ?? null

  const tracePath = pickAttachment(result, 'trace', artifactsDir)
  const screenshotPath = pickAttachment(result, 'screenshot', artifactsDir)
  const videoPath = pickAttachment(result, 'video', artifactsDir)

  return {
    scenario_id: scenario.scenario_id,
    title: specTitle || scenario.title,
    status,
    duration_ms: result?.duration ?? null,
    error_message: errMsg ? errMsg.slice(0, 2000) : null,
    error_stack: errStack ? errStack.slice(0, 4000) : null,
    stdout,
    trace_path: tracePath,
    screenshot_path: screenshotPath,
    video_path: videoPath,
    step_events: [],
  }
}

function mapStatus(s: string | undefined): ResultRow['status'] {
  switch (s) {
    case 'passed':
      return 'passed'
    case 'timedOut':
    case 'timedout':
      return 'timedout'
    case 'skipped':
      return 'skipped'
    default:
      return 'failed'
  }
}

function pickAttachment(
  result: PwTestResult | null,
  kind: 'trace' | 'screenshot' | 'video',
  artifactsDir: string,
): string | null {
  if (!result?.attachments) return null
  const match = result.attachments.find((a) => {
    if (kind === 'trace') {
      return a.name === 'trace' || a.contentType === 'application/zip'
    }
    if (kind === 'screenshot') {
      return a.contentType?.startsWith('image/')
    }
    // video: Playwright anexa com contentType video/webm ou video/mp4
    return a.contentType?.startsWith('video/')
  })
  if (!match?.path) return null
  if (match.path.startsWith(artifactsDir)) {
    return match.path
  }
  return match.path
}
