import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  crawlJobs,
  orgMembers,
  projectScenarios,
  projects,
} from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { getCurrentOrg } from '@/lib/auth/current-org'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'
import { slugify } from '@/lib/auth/project-access'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'
import { encryptSecret } from '@/lib/auth/totp'
import { createProjectSchema } from '@/lib/validators/project'
import { validateTargetUrl } from '@/lib/validators/url'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      targetUrl: projects.targetUrl,
      status: projects.status,
      authKind: projects.authKind,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      pagesCount: sql<number>`(
        SELECT COALESCE(MAX(${crawlJobs.pagesCount}), 0)
        FROM ${crawlJobs}
        WHERE ${crawlJobs.projectId} = ${projects.id}
          AND ${crawlJobs.status} = 'completed'
      )`,
      lastCrawlAt: sql<Date | null>`(
        SELECT MAX(${crawlJobs.finishedAt})
        FROM ${crawlJobs}
        WHERE ${crawlJobs.projectId} = ${projects.id}
          AND ${crawlJobs.status} = 'completed'
      )`,
    })
    .from(projects)
    .innerJoin(orgMembers, eq(orgMembers.orgId, projects.orgId))
    .where(eq(orgMembers.userId, session.user.id))
    .orderBy(desc(projects.updatedAt))

  return NextResponse.json({ items: rows })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const org = await getCurrentOrg(session.user.id)
  if (!org) return Problems.forbidden()

  const rl = await consumeToken(BUCKETS.projectCreate(org.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  const body = await req.json().catch(() => null)
  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const urlCheck = validateTargetUrl(parsed.data.targetUrl)
  if (!urlCheck.ok) {
    return Problems.invalidBody({ targetUrl: urlCheck.reason ?? 'invalid_url' })
  }

  if (parsed.data.authKind === 'form' && parsed.data.authForm) {
    const loginUrlCheck = validateTargetUrl(parsed.data.authForm.loginUrl)
    if (!loginUrlCheck.ok) {
      return Problems.invalidBody({
        loginUrl: loginUrlCheck.reason ?? 'invalid_url',
      })
    }
  }

  const slug = await uniqueSlug(org.id, parsed.data.name)

  let authCredentials: Buffer | null = null
  if (parsed.data.authKind === 'form' && parsed.data.authForm) {
    authCredentials = encryptSecret(JSON.stringify(parsed.data.authForm))
  }

  const created = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        orgId: org.id,
        name: parsed.data.name,
        slug,
        targetUrl: parsed.data.targetUrl,
        description: parsed.data.description,
        authKind: parsed.data.authKind,
        authCredentials,
        targetLocale: parsed.data.targetLocale ?? session.user.locale,
        createdBy: session.user.id,
        status: 'draft',
      })
      .returning()
    if (!project) throw new Error('insert_project_failed')

    if (parsed.data.scenarios.length > 0) {
      await tx.insert(projectScenarios).values(
        parsed.data.scenarios.map((description, index) => ({
          projectId: project.id,
          description,
          priority: index,
        })),
      )
    }

    // Dispara o primeiro crawl imediatamente
    await tx.insert(crawlJobs).values({
      projectId: project.id,
      requestedBy: session.user.id,
      status: 'pending',
    })
    await tx
      .update(projects)
      .set({ status: 'crawling', updatedAt: new Date() })
      .where(eq(projects.id, project.id))

    return project
  })

  await audit({
    userId: session.user.id,
    event: 'project_created',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { projectId: created.id, orgId: org.id, slug: created.slug },
    outcome: 'success',
  })

  return NextResponse.json(
    {
      id: created.id,
      slug: created.slug,
      name: created.name,
      status: created.status,
    },
    { status: 201 },
  )
}

async function uniqueSlug(orgId: string, name: string): Promise<string> {
  const base = slugify(name)
  let slug = base
  let attempt = 0
  while (attempt < 20) {
    const [clash] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.slug, slug)))
      .limit(1)
    if (!clash) return slug
    attempt++
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
  }
  throw new Error('could_not_generate_slug')
}
