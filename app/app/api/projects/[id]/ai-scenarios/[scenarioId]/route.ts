import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { analysisFeatures, analysisScenarios } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { updateScenarioSchema } from '@/lib/validators/analysis-edit'
import { recordReviewEvent } from '@/lib/db/clickhouse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; scenarioId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id, scenarioId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const body = await req.json().catch(() => null)
  const parsed = updateScenarioSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  // Se está movendo pra outra feature, valida que é do mesmo projeto
  if (parsed.data.moveToFeatureId) {
    const [target] = await db
      .select({ id: analysisFeatures.id })
      .from(analysisFeatures)
      .where(
        and(
          eq(analysisFeatures.id, parsed.data.moveToFeatureId),
          eq(analysisFeatures.projectId, project.id),
        ),
      )
      .limit(1)
    if (!target) return Problems.forbidden()
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (parsed.data.title !== undefined) updates.title = parsed.data.title
  if (parsed.data.rationale !== undefined)
    updates.rationale = parsed.data.rationale
  if (parsed.data.priority !== undefined)
    updates.priority = parsed.data.priority
  if (parsed.data.preconditions !== undefined)
    updates.preconditions = parsed.data.preconditions
  if (parsed.data.dataNeeded !== undefined)
    updates.dataNeeded = parsed.data.dataNeeded
  if (parsed.data.sortOrder !== undefined)
    updates.sortOrder = parsed.data.sortOrder
  if (parsed.data.reviewed !== undefined) {
    updates.reviewedAt = parsed.data.reviewed ? new Date() : null
    updates.reviewedBy = parsed.data.reviewed ? session.user.id : null
  }
  if (parsed.data.moveToFeatureId !== undefined) {
    updates.featureId = parsed.data.moveToFeatureId
  }

  const result = await db
    .update(analysisScenarios)
    .set(updates)
    .where(
      and(
        eq(analysisScenarios.id, scenarioId),
        eq(analysisScenarios.projectId, project.id),
      ),
    )
    .returning()

  if (result.length === 0) return Problems.forbidden()

  if (parsed.data.reviewed !== undefined && result[0]) {
    recordReviewEvent({
      project_id: project.id,
      target_kind: 'scenario',
      target_id: result[0].id,
      action: parsed.data.reviewed ? 'marked' : 'unmarked',
      user_id: session.user.id,
      user_display: session.user.displayName ?? session.user.email,
      title_snapshot: result[0].title,
    })
  }

  return NextResponse.json({ scenario: result[0] })
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; scenarioId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id, scenarioId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const deleted = await db
    .delete(analysisScenarios)
    .where(
      and(
        eq(analysisScenarios.id, scenarioId),
        eq(analysisScenarios.projectId, project.id),
      ),
    )
    .returning({ id: analysisScenarios.id })

  if (deleted.length === 0) return Problems.forbidden()
  return new NextResponse(null, { status: 204 })
}
