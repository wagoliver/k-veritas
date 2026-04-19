import { NextResponse, type NextRequest } from 'next/server'
import { desc, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { crawlElements, crawlJobs, crawlPages } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'

/**
 * GET /api/projects/[id]/crawls/latest
 * Retorna o crawl mais recente (qualquer status) + páginas capturadas
 * até o momento, para alimentar o feed ao vivo.
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

  const [job] = await db
    .select()
    .from(crawlJobs)
    .where(eq(crawlJobs.projectId, project.id))
    .orderBy(desc(crawlJobs.createdAt))
    .limit(1)

  if (!job) {
    return NextResponse.json({ crawl: null })
  }

  const pages = await db
    .select({
      id: crawlPages.id,
      url: crawlPages.url,
      title: crawlPages.title,
      statusCode: crawlPages.statusCode,
      discoveredAt: crawlPages.discoveredAt,
      elementsCount: sql<number>`(
        SELECT count(*) FROM ${crawlElements}
        WHERE ${crawlElements.pageId} = ${crawlPages.id}
      )`,
    })
    .from(crawlPages)
    .where(eq(crawlPages.crawlId, job.id))
    .orderBy(crawlPages.discoveredAt)

  return NextResponse.json({
    crawl: {
      id: job.id,
      status: job.status,
      pagesCount: job.pagesCount,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    },
    pages,
  })
}
