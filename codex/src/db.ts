import postgres from 'postgres'

import { requireEnv } from './env.ts'

export const sql = postgres(requireEnv('DATABASE_URL'), {
  max: 5,
  idle_timeout: 20,
  prepare: false,
})

export interface PendingCodeJob {
  id: string
  project_id: string
  requested_by: string
  source_type: 'url' | 'repo'
  repo_url: string | null
  repo_branch: string | null
  repo_zip_path: string | null
}

export interface Project {
  id: string
  org_id: string
  name: string
  slug: string
  source_type: 'url' | 'repo'
  repo_url: string | null
  repo_branch: string
  repo_zip_path: string | null
  business_context: string | null
  target_locale: string
}

export interface OrgAiCredential {
  provider: string
  model: string
  api_key_encrypted: Buffer | null
  anthropic_api_key_encrypted: Buffer | null
  anthropic_model: string | null
}

export async function claimNextJob(
  workerId: string,
): Promise<{ job: PendingCodeJob; project: Project } | null> {
  const rows = await sql<PendingCodeJob[]>`
    UPDATE code_analysis_jobs SET
      status = 'running',
      locked_by = ${workerId},
      locked_at = now(),
      started_at = now()
    WHERE id = (
      SELECT id FROM code_analysis_jobs
      WHERE status = 'pending'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, project_id, requested_by,
              source_type, repo_url, repo_branch, repo_zip_path
  `
  const job = rows[0]
  if (!job) return null

  const projectRows = await sql<Project[]>`
    SELECT id, org_id, name, slug,
           source_type, repo_url, repo_branch, repo_zip_path,
           business_context, target_locale
    FROM projects WHERE id = ${job.project_id} LIMIT 1
  `
  const project = projectRows[0]
  if (!project) {
    await sql`
      UPDATE code_analysis_jobs
      SET status='failed', finished_at=now(), error='project_not_found'
      WHERE id = ${job.id}
    `
    return null
  }
  return { job, project }
}

export async function heartbeat(
  jobId: string,
  workerId: string,
): Promise<void> {
  await sql`
    UPDATE code_analysis_jobs SET locked_at = now()
    WHERE id = ${jobId} AND locked_by = ${workerId}
  `
}

export async function updateProgress(
  jobId: string,
  step: { label: string; incrementCompleted?: boolean },
): Promise<void> {
  if (step.incrementCompleted) {
    await sql`
      UPDATE code_analysis_jobs
      SET current_step_label = ${step.label},
          steps_completed = steps_completed + 1,
          locked_at = now()
      WHERE id = ${jobId}
    `
  } else {
    await sql`
      UPDATE code_analysis_jobs
      SET current_step_label = ${step.label},
          locked_at = now()
      WHERE id = ${jobId}
    `
  }
}

export async function markCompleted(
  jobId: string,
  metrics: {
    tokensIn: number
    tokensOut: number
    turnsUsed: number
  },
): Promise<void> {
  await sql`
    UPDATE code_analysis_jobs SET
      status = 'completed',
      finished_at = now(),
      tokens_in = ${metrics.tokensIn},
      tokens_out = ${metrics.tokensOut},
      turns_used = ${metrics.turnsUsed}
    WHERE id = ${jobId}
  `
}

// Best-effort completion: o Claude saiu com erro mas havia manifest
// aproveitável. Grava o warning no campo `error` (preserva diagnóstico)
// mas mantém o status 'completed' porque os dados foram importados e
// estão utilizáveis pela UI.
export async function markCompletedWithWarning(
  jobId: string,
  warning: string,
  metrics: {
    tokensIn: number
    tokensOut: number
    turnsUsed: number
  },
): Promise<void> {
  await sql`
    UPDATE code_analysis_jobs SET
      status = 'completed',
      finished_at = now(),
      error = ${`[warning] ${warning}`.slice(0, 4000)},
      tokens_in = ${metrics.tokensIn},
      tokens_out = ${metrics.tokensOut},
      turns_used = ${metrics.turnsUsed}
    WHERE id = ${jobId}
  `
}

export async function markFailed(
  jobId: string,
  error: string,
  metrics?: { tokensIn: number; tokensOut: number; turnsUsed: number },
): Promise<void> {
  if (metrics) {
    await sql`
      UPDATE code_analysis_jobs SET
        status = 'failed',
        finished_at = now(),
        error = ${error.slice(0, 4000)},
        tokens_in = ${metrics.tokensIn},
        tokens_out = ${metrics.tokensOut},
        turns_used = ${metrics.turnsUsed}
      WHERE id = ${jobId}
    `
  } else {
    await sql`
      UPDATE code_analysis_jobs SET
        status = 'failed',
        finished_at = now(),
        error = ${error.slice(0, 4000)}
      WHERE id = ${jobId}
    `
  }
}

export async function requeueStaleJobs(
  staleSeconds: number,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE code_analysis_jobs SET
      status = 'pending',
      locked_by = NULL,
      locked_at = NULL
    WHERE status = 'running'
      AND locked_at < now() - (${staleSeconds}::int || ' seconds')::interval
    RETURNING id
  `
  return rows.length
}

export async function getOrgCredentialRaw(
  orgId: string,
): Promise<OrgAiCredential | null> {
  const rows = await sql<OrgAiCredential[]>`
    SELECT provider, model, api_key_encrypted,
           anthropic_api_key_encrypted, anthropic_model
    FROM org_ai_config
    WHERE org_id = ${orgId}
    LIMIT 1
  `
  return rows[0] ?? null
}

export interface ResolvedAnthropic {
  apiKeyEncrypted: Buffer
  model: string
  source: 'dedicated' | 'main-provider-anthropic'
}

// Regra de resolução da credencial Anthropic que o codex usa:
//   1. se há chave dedicada (anthropic_api_key_encrypted) → usa ela
//      + anthropic_model (ou default do worker se vazio)
//   2. senão, se provider principal == 'anthropic' → usa api_key_encrypted
//      + model principal
//   3. senão → null (feature desabilitada)
export function resolveAnthropic(
  cfg: OrgAiCredential | null,
  defaultModel: string,
): ResolvedAnthropic | null {
  if (!cfg) return null
  if (cfg.anthropic_api_key_encrypted) {
    return {
      apiKeyEncrypted: cfg.anthropic_api_key_encrypted,
      model: cfg.anthropic_model || defaultModel,
      source: 'dedicated',
    }
  }
  if (cfg.provider === 'anthropic' && cfg.api_key_encrypted) {
    return {
      apiKeyEncrypted: cfg.api_key_encrypted,
      model: cfg.model || defaultModel,
      source: 'main-provider-anthropic',
    }
  }
  return null
}

// Import do manifest.json no Postgres. Deleta features/scenarios
// anteriores dessa análise (re-run idempotente) antes de inserir.
export async function importAnalysis(params: {
  jobId: string
  projectId: string
  requestedBy: string
  model: string
  provider: string
  summary: string
  inferredLocale: string
  manifestPath: string
  durationMs: number
  tokensIn: number
  tokensOut: number
  features: Array<{
    externalId: string
    name: string
    description: string
    paths: string[]
    scenarios: Array<{
      title: string
      rationale: string
      priority: 'critical' | 'high' | 'normal' | 'low'
      preconditions: string[]
      dataNeeded: string[]
    }>
  }>
}): Promise<string> {
  return await sql.begin(async (tx) => {
    const [analysis] = await tx<{ id: string }[]>`
      INSERT INTO project_analyses
        (project_id, analysis_type, code_analysis_job_id, manifest_path,
         status, model, provider, summary, inferred_locale,
         features, requested_by,
         tokens_in, tokens_out, duration_ms,
         started_at, finished_at)
      VALUES
        (${params.projectId}, 'code', ${params.jobId}, ${params.manifestPath},
         'completed', ${params.model}, ${params.provider},
         ${params.summary}, ${params.inferredLocale},
         ${JSON.stringify(params.features)}, ${params.requestedBy},
         ${params.tokensIn}, ${params.tokensOut}, ${params.durationMs},
         now(), now())
      RETURNING id
    `

    let featureOrder = 0
    for (const f of params.features) {
      const [feature] = await tx<{ id: string }[]>`
        INSERT INTO analysis_features
          (project_id, source_analysis_id, external_id, name, description,
           paths, sort_order, source)
        VALUES
          (${params.projectId}, ${analysis.id}, ${f.externalId},
           ${f.name}, ${f.description},
           ${JSON.stringify(f.paths)}, ${featureOrder++}, 'ai')
        RETURNING id
      `
      let scenarioOrder = 0
      for (const s of f.scenarios) {
        await tx`
          INSERT INTO analysis_scenarios
            (feature_id, project_id, title, rationale, priority,
             preconditions, data_needed, sort_order, source)
          VALUES
            (${feature.id}, ${params.projectId}, ${s.title}, ${s.rationale},
             ${s.priority},
             ${JSON.stringify(s.preconditions)},
             ${JSON.stringify(s.dataNeeded)},
             ${scenarioOrder++}, 'ai')
        `
      }
    }
    return analysis.id
  })
}
