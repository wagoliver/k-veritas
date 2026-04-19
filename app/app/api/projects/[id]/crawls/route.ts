import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { crawlJobs, projects } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'
import { authorizeProject } from '@/lib/auth/project-access'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const items = await db
    .select({
      id: crawlJobs.id,
      status: crawlJobs.status,
      pagesCount: crawlJobs.pagesCount,
      error: crawlJobs.error,
      startedAt: crawlJobs.startedAt,
      finishedAt: crawlJobs.finishedAt,
      createdAt: crawlJobs.createdAt,
    })
    .from(crawlJobs)
    .where(eq(crawlJobs.projectId, project.id))
    .orderBy(desc(crawlJobs.createdAt))
    .limit(20)

  return NextResponse.json({ items })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const rl = await consumeToken(BUCKETS.crawlProject(project.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  // Corpo opcional: { scope: 'full' | 'single_path', url: '/register' }
  // Se vazio ou Content-Type não-JSON, assume full (retrocompat).
  let scope: 'full' | 'single_path' = 'full'
  let scopeUrl: string | null = null
  if (req.headers.get('content-type')?.includes('application/json')) {
    const body = (await req.json().catch(() => null)) as {
      scope?: unknown
      url?: unknown
    } | null
    if (body?.scope === 'single_path') {
      if (typeof body.url !== 'string' || body.url.length === 0) {
        return Problems.invalidBody()
      }
      const resolved = resolveScopeUrl(project.targetUrl, body.url)
      if (!resolved) return Problems.invalidBody()
      scope = 'single_path'
      scopeUrl = resolved
    }
  }

  // Impede job duplo só quando for full crawl. Re-crawler single_path
  // pode acumular vários em paralelo sem invalidar o mapa.
  if (scope === 'full') {
    const [running] = await db
      .select({ id: crawlJobs.id })
      .from(crawlJobs)
      .where(
        and(
          eq(crawlJobs.projectId, project.id),
          eq(crawlJobs.status, 'running'),
          eq(crawlJobs.scope, 'full'),
        ),
      )
      .limit(1)
    if (running) {
      return Problems.conflict(
        'crawl_already_running',
        'Aguarde o crawl atual terminar.',
      )
    }
  }

  const [job] = await db
    .insert(crawlJobs)
    .values({
      projectId: project.id,
      requestedBy: session.user.id,
      status: 'pending',
      scope,
      scopeUrl,
    })
    .returning({ id: crawlJobs.id })
  if (!job) return Problems.server()

  // Só muda o status do projeto pra 'crawling' em full crawl. Single_path
  // não deixa o projeto em estado "crawling" (ele é auxiliar).
  if (scope === 'full') {
    await db
      .update(projects)
      .set({ status: 'crawling', updatedAt: new Date() })
      .where(eq(projects.id, project.id))
  }

  await audit({
    userId: session.user.id,
    event: scope === 'single_path' ? 'crawl_single_path_requested' : 'crawl_requested',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { projectId: project.id, crawlId: job.id, scope, scopeUrl },
    outcome: 'success',
  })

  return NextResponse.json(
    { id: job.id, status: 'pending', scope },
    { status: 202 },
  )
}

/**
 * Resolve o URL do scope (ex: '/register') contra o target_url do projeto,
 * retornando uma URL absoluta same-origin. Rejeita qualquer coisa fora do
 * host do target. Aceita tanto path relativo quanto URL completa.
 */
function resolveScopeUrl(targetUrl: string, input: string): string | null {
  try {
    const base = new URL(targetUrl)
    const resolved = new URL(input, base)
    if (resolved.host !== base.host) return null
    if (resolved.protocol !== base.protocol) return null
    resolved.hash = ''
    // Normaliza trailing slash pra casar com o padrão do crawler
    if (resolved.pathname.length > 1 && resolved.pathname.endsWith('/')) {
      resolved.pathname = resolved.pathname.replace(/\/+$/, '')
    }
    return resolved.toString()
  } catch {
    return null
  }
}
