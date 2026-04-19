import { NextResponse, type NextRequest } from 'next/server'
import { desc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { projectTestRuns } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — histórico de test runs do projeto, mais recente primeiro.
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

  const runs = await db
    .select({
      id: projectTestRuns.id,
      status: projectTestRuns.status,
      provider: projectTestRuns.provider,
      model: projectTestRuns.model,
      scenariosIncludedCount: projectTestRuns.scenariosIncludedCount,
      featuresCount: projectTestRuns.featuresCount,
      filesCount: projectTestRuns.filesCount,
      tokensIn: projectTestRuns.tokensIn,
      tokensOut: projectTestRuns.tokensOut,
      durationMs: projectTestRuns.durationMs,
      error: projectTestRuns.error,
      startedAt: projectTestRuns.startedAt,
      finishedAt: projectTestRuns.finishedAt,
      createdAt: projectTestRuns.createdAt,
    })
    .from(projectTestRuns)
    .where(eq(projectTestRuns.projectId, project.id))
    .orderBy(desc(projectTestRuns.createdAt))
    .limit(50)

  return NextResponse.json(
    { runs },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
