import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { codeAnalysisEvents, codeAnalysisJobs } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/projects/:id/code-analyses/:jobId/events
 *
 * Feed cronológico dos eventos do job de análise de código — alimenta
 * o CodeAnalysisLogStream (timeline visual tipo crawl-log-stream).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; jobId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, jobId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  // Garante que o job pertence ao projeto do usuário.
  const [job] = await db
    .select({
      id: codeAnalysisJobs.id,
      status: codeAnalysisJobs.status,
      stepsCompleted: codeAnalysisJobs.stepsCompleted,
      tokensIn: codeAnalysisJobs.tokensIn,
      tokensOut: codeAnalysisJobs.tokensOut,
      turnsUsed: codeAnalysisJobs.turnsUsed,
      error: codeAnalysisJobs.error,
      createdAt: codeAnalysisJobs.createdAt,
      startedAt: codeAnalysisJobs.startedAt,
      finishedAt: codeAnalysisJobs.finishedAt,
    })
    .from(codeAnalysisJobs)
    .where(
      and(
        eq(codeAnalysisJobs.id, jobId),
        eq(codeAnalysisJobs.projectId, project.id),
      ),
    )
    .limit(1)

  if (!job) {
    return NextResponse.json(
      { error: 'job_not_found' },
      { status: 404 },
    )
  }

  const events = await db
    .select({
      id: codeAnalysisEvents.id,
      createdAt: codeAnalysisEvents.createdAt,
      kind: codeAnalysisEvents.kind,
      label: codeAnalysisEvents.label,
      detail: codeAnalysisEvents.detail,
    })
    .from(codeAnalysisEvents)
    .where(eq(codeAnalysisEvents.jobId, jobId))
    .orderBy(asc(codeAnalysisEvents.createdAt))
    .limit(500)

  return NextResponse.json(
    { job, events },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
