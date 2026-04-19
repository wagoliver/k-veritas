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

  // Impede job duplo se já há um rodando
  const [running] = await db
    .select({ id: crawlJobs.id })
    .from(crawlJobs)
    .where(
      and(
        eq(crawlJobs.projectId, project.id),
        eq(crawlJobs.status, 'running'),
      ),
    )
    .limit(1)
  if (running) {
    return Problems.conflict(
      'crawl_already_running',
      'Aguarde o crawl atual terminar.',
    )
  }

  const [job] = await db
    .insert(crawlJobs)
    .values({
      projectId: project.id,
      requestedBy: session.user.id,
      status: 'pending',
    })
    .returning({ id: crawlJobs.id })
  if (!job) return Problems.server()

  await db
    .update(projects)
    .set({ status: 'crawling', updatedAt: new Date() })
    .where(eq(projects.id, project.id))

  await audit({
    userId: session.user.id,
    event: 'crawl_requested',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { projectId: project.id, crawlId: job.id },
    outcome: 'success',
  })

  return NextResponse.json({ id: job.id, status: 'pending' }, { status: 202 })
}
