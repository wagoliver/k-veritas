import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { crawlElements, crawlJobs, crawlPages } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/projects/[id]/pages/[pageId]/elements
 * Lista todos os elementos capturados de uma página específica.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; pageId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, pageId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const [page] = await db
    .select({
      id: crawlPages.id,
      url: crawlPages.url,
      title: crawlPages.title,
      statusCode: crawlPages.statusCode,
      discoveredAt: crawlPages.discoveredAt,
      crawlId: crawlPages.crawlId,
    })
    .from(crawlPages)
    .innerJoin(crawlJobs, eq(crawlJobs.id, crawlPages.crawlId))
    .where(and(eq(crawlPages.id, pageId), eq(crawlJobs.projectId, project.id)))
    .limit(1)

  if (!page) return Problems.forbidden()

  const elements = await db
    .select({
      id: crawlElements.id,
      kind: crawlElements.kind,
      role: crawlElements.role,
      label: crawlElements.label,
      selector: crawlElements.selector,
      meta: crawlElements.meta,
    })
    .from(crawlElements)
    .where(eq(crawlElements.pageId, pageId))
    .orderBy(crawlElements.kind, crawlElements.id)

  return NextResponse.json(
    { page, elements },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
