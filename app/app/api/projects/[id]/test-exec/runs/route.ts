import { NextResponse, type NextRequest } from 'next/server'
import { desc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { testExecRuns } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — histórico de runs de execução do projeto. Ordenado por
 * createdAt desc, limitado a 50.
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

  const rows = await db
    .select({
      id: testExecRuns.id,
      scope: testExecRuns.scope,
      scopeId: testExecRuns.scopeId,
      status: testExecRuns.status,
      scenariosCount: testExecRuns.scenariosCount,
      passedCount: testExecRuns.passedCount,
      failedCount: testExecRuns.failedCount,
      error: testExecRuns.error,
      startedAt: testExecRuns.startedAt,
      finishedAt: testExecRuns.finishedAt,
      createdAt: testExecRuns.createdAt,
    })
    .from(testExecRuns)
    .where(eq(testExecRuns.projectId, project.id))
    .orderBy(desc(testExecRuns.createdAt))
    .limit(50)

  return NextResponse.json(
    { runs: rows },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
