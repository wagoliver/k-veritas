import postgres from 'postgres'

import { requireEnv } from './env.ts'

export const sql = postgres(requireEnv('DATABASE_URL'), {
  max: 5,
  idle_timeout: 20,
  prepare: false,
})

export interface PendingExecJob {
  id: string
  project_id: string
  scope: 'scenario' | 'feature' | 'project'
  scope_id: string | null
  requested_by: string
}

export interface Project {
  id: string
  target_url: string
  auth_kind: 'none' | 'form'
  auth_credentials: Buffer | null
}

export interface ScenarioToRun {
  scenario_id: string
  title: string
  code: string
  file_header: string
  file_footer: string
  feature_external_id: string
}

export async function claimNextJob(
  workerId: string,
): Promise<{ job: PendingExecJob; project: Project } | null> {
  const rows = await sql<PendingExecJob[]>`
    UPDATE test_exec_runs SET
      status = 'running',
      locked_by = ${workerId},
      locked_at = now(),
      started_at = now()
    WHERE id = (
      SELECT id FROM test_exec_runs
      WHERE status = 'pending'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, project_id, scope, scope_id, requested_by
  `

  const job = rows[0]
  if (!job) return null

  const projectRows = await sql<Project[]>`
    SELECT id, target_url, auth_kind, auth_credentials
    FROM projects WHERE id = ${job.project_id} LIMIT 1
  `
  const project = projectRows[0]
  if (!project) {
    await sql`
      UPDATE test_exec_runs SET status='failed', finished_at=now(), error='project_not_found'
      WHERE id = ${job.id}
    `
    return null
  }

  return { job, project }
}

/**
 * Pra um job de escopo 'scenario', busca os dados necessários pra
 * montar o arquivo .spec.ts. No modelo novo:
 *   - code vem de feature_ai_scenario_tests (UNIQUE por feature+scenario,
 *     então 1 row por cenário)
 *   - title vem do jsonb analysis_features.ai_scenarios (match por id)
 *   - feature_external_id vem de analysis_features.external_id
 *   - file_header/file_footer ficam vazios (código gerado é self-contained,
 *     inclui o import do @playwright/test direto)
 */
export async function loadScenarioExecData(
  projectId: string,
  scenarioId: string,
): Promise<ScenarioToRun | null> {
  const rows = await sql<
    Array<{
      scenario_id: string
      title: string | null
      code: string
      feature_external_id: string
    }>
  >`
    SELECT
      t.scenario_id AS scenario_id,
      (
        SELECT elem->>'description'
        FROM jsonb_array_elements(f.ai_scenarios) AS elem
        WHERE elem->>'id' = t.scenario_id
        LIMIT 1
      ) AS title,
      t.code AS code,
      f.external_id AS feature_external_id
    FROM feature_ai_scenario_tests t
    JOIN analysis_features f ON f.id = t.feature_id
    WHERE t.project_id = ${projectId}
      AND t.scenario_id = ${scenarioId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    scenario_id: row.scenario_id,
    title: row.title ?? 'Test scenario',
    code: row.code,
    file_header: '',
    file_footer: '',
    feature_external_id: row.feature_external_id,
  }
}

/**
 * Carrega todas as variáveis de ambiente cadastradas pra este projeto
 * na tela Setup. Valor vem cifrado (bytea) — o chamador decifra via
 * `decryptSecret` e injeta no env do processo do Playwright.
 */
export async function loadProjectTestEnvVars(
  projectId: string,
): Promise<Array<{ name: string; valueEncrypted: Buffer }>> {
  const rows = await sql<
    Array<{ name: string; value_encrypted: Buffer }>
  >`
    SELECT name, value_encrypted
    FROM project_test_env_vars
    WHERE project_id = ${projectId}
    ORDER BY name
  `
  return rows.map((r) => ({
    name: r.name,
    valueEncrypted: r.value_encrypted,
  }))
}

export async function heartbeat(jobId: string, workerId: string): Promise<void> {
  await sql`
    UPDATE test_exec_runs SET locked_at = now()
    WHERE id = ${jobId} AND locked_by = ${workerId}
  `
}

/**
 * Atualiza o progresso live do run conforme o reporter do Playwright
 * emite eventos. Worker chama throttled (~400ms) pra não martelar o DB.
 */
export async function updateRunProgress(
  jobId: string,
  data: {
    stepsCompleted: number
    stepsTotal: number
    currentStepLabel: string | null
    currentStepLine: number | null
  },
): Promise<void> {
  await sql`
    UPDATE test_exec_runs SET
      steps_completed = ${data.stepsCompleted},
      steps_total = ${data.stepsTotal},
      current_step_label = ${data.currentStepLabel},
      current_step_line = ${data.currentStepLine}
    WHERE id = ${jobId}
  `
}

export interface StepEvent {
  step_index: number
  title: string
  status: 'passed' | 'failed' | 'skipped'
  duration_ms: number | null
  error_message: string | null
  error_stack: string | null
  line_in_spec: number | null
  started_at: string
  finished_at: string | null
}

export interface ResultRow {
  scenario_id: string
  title: string
  status: 'passed' | 'failed' | 'skipped' | 'timedout'
  duration_ms: number | null
  error_message: string | null
  error_stack: string | null
  stdout: string | null
  trace_path: string | null
  screenshot_path: string | null
  video_path: string | null
  step_events: StepEvent[]
}

export async function markRunCompleted(
  jobId: string,
  projectId: string,
  scenariosCount: number,
  results: ResultRow[],
): Promise<void> {
  const passed = results.filter((r) => r.status === 'passed').length
  const failed = results.filter((r) => r.status !== 'passed').length

  await sql.begin(async (tx) => {
    await tx`
      UPDATE test_exec_runs SET
        status='completed',
        finished_at=now(),
        scenarios_count=${scenariosCount},
        passed_count=${passed},
        failed_count=${failed}
      WHERE id=${jobId}
    `

    if (results.length === 0) return

    for (const r of results) {
      // scenario_id tem FK pra analysis_scenarios (modelo legado). No modelo
      // novo o cenário vive como UUID dentro de analysis_features.ai_scenarios
      // (jsonb), sem row relacional — setamos NULL. O scenario_id_snapshot
      // é o UUID real do cenário e não tem FK; é o que a UI consulta.
      const [inserted] = await tx<{ id: string }[]>`
        INSERT INTO test_exec_results ${tx({
          run_id: jobId,
          project_id: projectId,
          scenario_id: null,
          scenario_id_snapshot: r.scenario_id,
          title_snapshot: r.title,
          status: r.status,
          duration_ms: r.duration_ms,
          error_message: r.error_message,
          error_stack: r.error_stack,
          trace_path: r.trace_path,
          screenshot_path: r.screenshot_path,
          video_path: r.video_path,
          stdout: r.stdout,
        })}
        RETURNING id
      `
      if (!inserted || r.step_events.length === 0) continue

      const eventValues = r.step_events.map((ev) => ({
        result_id: inserted.id,
        step_index: ev.step_index,
        title: ev.title,
        status: ev.status,
        duration_ms: ev.duration_ms,
        error_message: ev.error_message,
        error_stack: ev.error_stack,
        line_in_spec: ev.line_in_spec,
        started_at: ev.started_at,
        finished_at: ev.finished_at,
      }))
      await tx`INSERT INTO test_exec_step_events ${tx(eventValues)}`
    }
  })
}

export async function markRunFailed(
  jobId: string,
  error: string,
): Promise<void> {
  await sql`
    UPDATE test_exec_runs SET
      status='failed', finished_at=now(), error=${error.slice(0, 1000)}
    WHERE id=${jobId}
  `
}

export async function requeueStaleJobs(timeoutSeconds: number): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE test_exec_runs SET
      status='pending', locked_by=NULL, locked_at=NULL
    WHERE status='running'
      AND locked_at IS NOT NULL
      AND locked_at < now() - ${timeoutSeconds} * INTERVAL '1 second'
    RETURNING id
  `
  return rows.length
}
