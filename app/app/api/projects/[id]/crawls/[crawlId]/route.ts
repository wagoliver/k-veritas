import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { crawlJobs } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; crawlId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, crawlId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const [job] = await db
    .select()
    .from(crawlJobs)
    .where(and(eq(crawlJobs.id, crawlId), eq(crawlJobs.projectId, project.id)))
    .limit(1)
  if (!job) return Problems.forbidden()

  return NextResponse.json({
    id: job.id,
    status: job.status,
    pagesCount: job.pagesCount,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
  })
}
