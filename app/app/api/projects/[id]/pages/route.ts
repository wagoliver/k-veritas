import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { crawlElements, crawlJobs, crawlPages } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/projects/[id]/pages
 * Retorna as páginas do último crawl completado.
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

  // IMPORTANTE: filtra scope='full'. Jobs single_path completam com o
  // mesmo status='completed' mas não têm crawl_pages próprios (eles fazem
  // upsert no crawl full mais recente). Se não filtrar, um single_path
  // recém-concluído vira o "último" e retorna lista vazia.
  const [lastCompleted] = await db
    .select({ id: crawlJobs.id })
    .from(crawlJobs)
    .where(
      and(
        eq(crawlJobs.projectId, project.id),
        eq(crawlJobs.status, 'completed'),
        eq(crawlJobs.scope, 'full'),
      ),
    )
    .orderBy(desc(crawlJobs.finishedAt))
    .limit(1)

  if (!lastCompleted) {
    return NextResponse.json({ crawlId: null, items: [] })
  }

  const pages = await db
    .select({
      id: crawlPages.id,
      url: crawlPages.url,
      title: crawlPages.title,
      statusCode: crawlPages.statusCode,
      redirectedTo: crawlPages.redirectedTo,
      discoveredAt: crawlPages.discoveredAt,
      elementsCount: sql<number>`count(${crawlElements.id})::int`,
    })
    .from(crawlPages)
    .leftJoin(crawlElements, eq(crawlElements.pageId, crawlPages.id))
    .where(eq(crawlPages.crawlId, lastCompleted.id))
    .groupBy(crawlPages.id)
    .orderBy(crawlPages.discoveredAt)

  return NextResponse.json({ crawlId: lastCompleted.id, items: pages })
}
