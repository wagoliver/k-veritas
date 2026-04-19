import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { testExecResults, testExecRuns } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — detalhe de um run + resultados por cenário.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, runId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const [run] = await db
    .select()
    .from(testExecRuns)
    .where(
      and(
        eq(testExecRuns.id, runId),
        eq(testExecRuns.projectId, project.id),
      ),
    )
    .limit(1)

  if (!run) return Problems.forbidden()

  const results = await db
    .select({
      id: testExecResults.id,
      scenarioId: testExecResults.scenarioId,
      scenarioIdSnapshot: testExecResults.scenarioIdSnapshot,
      titleSnapshot: testExecResults.titleSnapshot,
      status: testExecResults.status,
      durationMs: testExecResults.durationMs,
      errorMessage: testExecResults.errorMessage,
      errorStack: testExecResults.errorStack,
      tracePath: testExecResults.tracePath,
      screenshotPath: testExecResults.screenshotPath,
      createdAt: testExecResults.createdAt,
    })
    .from(testExecResults)
    .where(eq(testExecResults.runId, runId))
    .orderBy(asc(testExecResults.createdAt))

  return NextResponse.json(
    {
      run: {
        id: run.id,
        scope: run.scope,
        scopeId: run.scopeId,
        status: run.status,
        scenariosCount: run.scenariosCount,
        passedCount: run.passedCount,
        failedCount: run.failedCount,
        error: run.error,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
      },
      results,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
