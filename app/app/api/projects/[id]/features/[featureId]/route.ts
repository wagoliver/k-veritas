import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { analysisFeatures, users } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { updateFeatureSchema } from '@/lib/validators/analysis-edit'
import { recordReviewEvent } from '@/lib/db/clickhouse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; featureId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id, featureId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const body = await req.json().catch(() => null)
  const parsed = updateFeatureSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.description !== undefined)
    updates.description = parsed.data.description
  if (parsed.data.paths !== undefined) updates.paths = parsed.data.paths
  if (parsed.data.sortOrder !== undefined)
    updates.sortOrder = parsed.data.sortOrder
  if (parsed.data.reviewed !== undefined) {
    updates.reviewedAt = parsed.data.reviewed ? new Date() : null
    updates.reviewedBy = parsed.data.reviewed ? session.user.id : null
  }

  const result = await db
    .update(analysisFeatures)
    .set(updates)
    .where(
      and(
        eq(analysisFeatures.id, featureId),
        eq(analysisFeatures.projectId, project.id),
      ),
    )
    .returning()

  if (result.length === 0) return Problems.forbidden()

  // Emite evento de revisão no ClickHouse pra auditoria temporal.
  // Fire-and-forget; Postgres já tem o estado atual.
  if (parsed.data.reviewed !== undefined && result[0]) {
    recordReviewEvent({
      project_id: project.id,
      target_kind: 'feature',
      target_id: result[0].id,
      action: parsed.data.reviewed ? 'marked' : 'unmarked',
      user_id: session.user.id,
      user_display: session.user.displayName ?? session.user.email,
      title_snapshot: result[0].name,
    })
  }

  return NextResponse.json({ feature: result[0] })
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; featureId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id, featureId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const deleted = await db
    .delete(analysisFeatures)
    .where(
      and(
        eq(analysisFeatures.id, featureId),
        eq(analysisFeatures.projectId, project.id),
      ),
    )
    .returning({ id: analysisFeatures.id })

  if (deleted.length === 0) return Problems.forbidden()
  return new NextResponse(null, { status: 204 })
}
