import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { crawlJobs, crawlPages } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'
import { authorizeProject } from '@/lib/auth/project-access'
import { validateTargetUrl } from '@/lib/validators/url'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/projects/[id]/pages/[pageId]/recheck
 *
 * Faz um GET simples na URL da página (sem Playwright/crawler completo)
 * apenas para revalidar o status HTTP. Útil para ver se uma rota que
 * retornou 403/404 voltou. Atualiza `crawl_pages.status_code`.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; pageId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id, pageId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const [row] = await db
    .select({
      id: crawlPages.id,
      url: crawlPages.url,
      crawlId: crawlPages.crawlId,
    })
    .from(crawlPages)
    .innerJoin(crawlJobs, eq(crawlJobs.id, crawlPages.crawlId))
    .where(
      and(eq(crawlPages.id, pageId), eq(crawlJobs.projectId, project.id)),
    )
    .limit(1)

  if (!row) return Problems.forbidden()

  const check = validateTargetUrl(row.url)
  if (!check.ok) {
    return Problems.invalidBody({ url: check.reason ?? 'invalid_url' })
  }

  let newStatus: number | null = null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const res = await fetch(row.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (k-veritas recheck) compatible; +https://k-veritas.local',
      },
    })
    clearTimeout(timer)
    newStatus = res.status
  } catch {
    newStatus = null
  }

  await db
    .update(crawlPages)
    .set({ statusCode: newStatus })
    .where(eq(crawlPages.id, row.id))

  await audit({
    userId: session.user.id,
    event: 'page_rechecked',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: {
      projectId: project.id,
      pageId: row.id,
      url: row.url,
      statusCode: newStatus,
    },
    outcome: newStatus !== null && newStatus < 400 ? 'success' : 'failure',
  })

  return NextResponse.json({ statusCode: newStatus })
}
