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
 * reconstruir o arquivo .spec.ts: header/footer da feature + snippet
 * do cenário específico.
 */
export async function loadScenarioExecData(
  projectId: string,
  scenarioId: string,
): Promise<ScenarioToRun | null> {
  const rows = await sql<ScenarioToRun[]>`
    SELECT
      st.scenario_id_snapshot AS scenario_id,
      st.title_snapshot AS title,
      st.code AS code,
      ftf.file_header AS file_header,
      ftf.file_footer AS file_footer,
      st.feature_external_id_snapshot AS feature_external_id
    FROM scenario_tests st
    LEFT JOIN feature_test_files ftf
      ON ftf.test_run_id = st.test_run_id
     AND ftf.feature_external_id_snapshot = st.feature_external_id_snapshot
    WHERE st.project_id = ${projectId}
      AND st.scenario_id_snapshot = ${scenarioId}
    ORDER BY st.created_at DESC
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function heartbeat(jobId: string, workerId: string): Promise<void> {
  await sql`
    UPDATE test_exec_runs SET locked_at = now()
    WHERE id = ${jobId} AND locked_by = ${workerId}
  `
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

    if (results.length > 0) {
      const values = results.map((r) => ({
        run_id: jobId,
        project_id: projectId,
        scenario_id: r.scenario_id,
        scenario_id_snapshot: r.scenario_id,
        title_snapshot: r.title,
        status: r.status,
        duration_ms: r.duration_ms,
        error_message: r.error_message,
        error_stack: r.error_stack,
        trace_path: r.trace_path,
        screenshot_path: r.screenshot_path,
        stdout: r.stdout,
      }))
      await tx`INSERT INTO test_exec_results ${tx(values)}`
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
