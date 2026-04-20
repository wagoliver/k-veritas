import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { purgeProjectCrawlHistory } from '@/lib/db/clickhouse'
import { projects } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'
import { authorizeProject } from '@/lib/auth/project-access'
import { encryptSecret } from '@/lib/auth/totp'
import { updateProjectSchema } from '@/lib/validators/project'
import { validateRepoUrl, validateTargetUrl } from '@/lib/validators/url'

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

  return NextResponse.json({
    id: project.id,
    orgId: project.orgId,
    name: project.name,
    slug: project.slug,
    targetUrl: project.targetUrl,
    description: project.description,
    authKind: project.authKind,
    ingestionMode: project.ingestionMode,
    crawlMaxDepth: project.crawlMaxDepth,
    targetLocale: project.targetLocale,
    status: project.status,
    sourceType: project.sourceType,
    repoUrl: project.repoUrl,
    repoBranch: project.repoBranch,
    businessContext: project.businessContext,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  })
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const body = await req.json().catch(() => null)
  const parsed = updateProjectSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.description !== undefined)
    updates.description = parsed.data.description
  if (parsed.data.crawlMaxDepth !== undefined)
    updates.crawlMaxDepth = parsed.data.crawlMaxDepth
  if (parsed.data.targetLocale !== undefined)
    updates.targetLocale = parsed.data.targetLocale

  if (parsed.data.targetUrl !== undefined) {
    const check = validateTargetUrl(parsed.data.targetUrl)
    if (!check.ok) {
      return Problems.invalidBody({ targetUrl: check.reason ?? 'invalid_url' })
    }
    updates.targetUrl = parsed.data.targetUrl
  }

  if (parsed.data.authKind !== undefined) {
    updates.authKind = parsed.data.authKind
    if (parsed.data.authKind === 'none') {
      updates.authCredentials = null
    } else if (parsed.data.authKind === 'form' && parsed.data.authForm) {
      const loginCheck = validateTargetUrl(parsed.data.authForm.loginUrl)
      if (!loginCheck.ok) {
        return Problems.invalidBody({
          loginUrl: loginCheck.reason ?? 'invalid_url',
        })
      }
      updates.authCredentials = encryptSecret(
        JSON.stringify(parsed.data.authForm),
      )
    }
  }

  if (parsed.data.repoUrl !== undefined) {
    const check = validateRepoUrl(parsed.data.repoUrl)
    if (!check.ok) {
      return Problems.invalidBody({ repoUrl: check.reason ?? 'invalid_repo_url' })
    }
    updates.repoUrl = check.normalized
  }

  if (parsed.data.repoBranch !== undefined) {
    updates.repoBranch = parsed.data.repoBranch
  }

  if (parsed.data.businessContext !== undefined) {
    updates.businessContext = parsed.data.businessContext || null
  }

  await db.update(projects).set(updates).where(eq(projects.id, project.id))

  await audit({
    userId: session.user.id,
    event: 'project_updated',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { projectId: project.id, fields: Object.keys(updates) },
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  await db.delete(projects).where(eq(projects.id, project.id))

  // Limpa histórico temporal no ClickHouse (mutação assíncrona)
  purgeProjectCrawlHistory(project.id)

  await audit({
    userId: session.user.id,
    event: 'project_deleted',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { projectId: project.id, slug: project.slug },
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
