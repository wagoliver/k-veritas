import { mkdir, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

import type { PendingExecJob, Project, ScenarioToRun, ResultRow } from './db.ts'
import { decryptSecret } from './crypto.ts'

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
  playwrightTimeoutMs: number
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

    const { specFileName, specContent } = buildSpecFile(scenario)
    await writeFile(join(testsDir, specFileName), specContent, 'utf8')

    const config = buildPlaywrightConfig(
      project,
      artifactsDir,
      reportPath,
      opts.playwrightTimeoutMs,
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

    // Spawn npx playwright test dentro do /work/<runId>
    // Usa o node_modules já instalado em /app (via NODE_PATH).
    const exit = await spawnPlaywright(runDir, reportPath, env)

    const reportText = await readOptionalFile(reportPath)
    const parsed = reportText
      ? (JSON.parse(reportText) as PlaywrightJsonReport)
      : null

    return extractResults(parsed, scenario, exit.stdout, artifactsDir)
  } finally {
    // Limpa scratchpad; mantém artefatos em /data
    await rm(runDir, { recursive: true, force: true }).catch(() => {})
  }
}

function buildSpecFile(scenario: ScenarioToRun): {
  specFileName: string
  specContent: string
} {
  // Reconstitui o arquivo a partir do header/footer + snippet do cenário.
  // Se feature_test_files não existir (runs antigos), usa fallback.
  const header =
    scenario.file_header ||
    `import { test, expect } from '@playwright/test'\n\ntest.describe('${scenario.feature_external_id}', () => {\n`
  const footer = scenario.file_footer || '})'

  const indentedCode = scenario.code
    .split('\n')
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join('\n')

  const specContent = `${header}\n${indentedCode}\n${footer}\n`
  const specFileName = `scenario-${scenario.scenario_id}.spec.ts`
  return { specFileName, specContent }
}

function buildPlaywrightConfig(
  project: Project,
  artifactsDir: string,
  reportPath: string,
  timeoutMs: number,
): string {
  // IMPORTANTE: outputFile do reporter é resolvido relativo ao CWD do
  // processo playwright (não à config). Como spawnamos com cwd=/app,
  // usar caminho absoluto evita que o report saia em /app/report.json.
  return `import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: ${timeoutMs},
  fullyParallel: false,
  retries: 0,
  reporter: [['json', { outputFile: ${JSON.stringify(reportPath)} }]],
  outputDir: ${JSON.stringify(artifactsDir)},
  use: {
    baseURL: ${JSON.stringify(project.target_url)},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
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
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    // NODE_PATH aponta pro node_modules instalado em /app pelo Dockerfile,
    // permitindo que @playwright/test seja resolvido mesmo rodando de /work.
    const child = spawn(
      'npx',
      ['playwright', 'test', `--config=${cwd}/playwright.config.ts`],
      {
        cwd: '/app',
        env: {
          ...env,
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
          // Silencia progress TTY pro stdout ficar parseável
          CI: '1',
        },
      },
    )

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => {
      const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : '')
      resolve({ stdout: combined.slice(-8_000), exitCode: code ?? 0 })
    })
    child.on('error', (err) => {
      resolve({
        stdout: `[spawn error] ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
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
  kind: 'trace' | 'screenshot',
  artifactsDir: string,
): string | null {
  if (!result?.attachments) return null
  const match = result.attachments.find((a) =>
    kind === 'trace'
      ? a.name === 'trace' || a.contentType === 'application/zip'
      : a.contentType?.startsWith('image/'),
  )
  if (!match?.path) return null
  // Caminho absoluto vem do Playwright; guarda relativo a /data pra servir depois
  if (match.path.startsWith(artifactsDir)) {
    return match.path
  }
  return match.path
}
