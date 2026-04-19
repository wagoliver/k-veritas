import { NextResponse, type NextRequest } from 'next/server'
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — retorna o ÚLTIMO resultado de cada cenário do projeto (DISTINCT
 * ON scenario_id_snapshot). A UI da aba Execução usa pra saber o badge
 * de cada cenário e qual run em andamento está associado a qual scenario.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const rows = await db.execute<{
    scenario_id_snapshot: string
    run_id: string
    status: string
    duration_ms: number | null
    error_message: string | null
    created_at: Date
  }>(sql`
    SELECT DISTINCT ON (scenario_id_snapshot)
      scenario_id_snapshot,
      run_id,
      status,
      duration_ms,
      error_message,
      created_at
    FROM test_exec_results
    WHERE project_id = ${project.id}
    ORDER BY scenario_id_snapshot, created_at DESC
  `)

  // Também devolve runs em andamento (pending/running) pra UI poder
  // mostrar "rodando..." no cenário correspondente (scope='scenario')
  const pending = await db.execute<{
    scope_id: string | null
    run_id: string
    status: string
    created_at: Date
  }>(sql`
    SELECT scope_id, id AS run_id, status, created_at
    FROM test_exec_runs
    WHERE project_id = ${project.id}
      AND status IN ('pending','running')
      AND scope = 'scenario'
    ORDER BY created_at DESC
  `)

  return NextResponse.json(
    {
      latestByScenario: rows.map((r) => ({
        scenarioId: r.scenario_id_snapshot,
        runId: r.run_id,
        status: r.status,
        durationMs: r.duration_ms,
        errorMessage: r.error_message,
        createdAt:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : String(r.created_at),
      })),
      runningByScenario: pending.map((r) => ({
        scenarioId: r.scope_id,
        runId: r.run_id,
        status: r.status,
        createdAt:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : String(r.created_at),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
