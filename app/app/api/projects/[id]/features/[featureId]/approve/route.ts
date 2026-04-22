import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { analysisFeatures } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { recordReviewEvent } from '@/lib/db/clickhouse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST — aprova a feature (QA validou o aiUnderstanding + aiScenarios).
 * DELETE — remove a aprovação (QA quer revisar de novo).
 */
export async function POST(
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

  const result = await db
    .update(analysisFeatures)
    .set({
      approvedAt: new Date(),
      approvedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(analysisFeatures.id, featureId),
        eq(analysisFeatures.projectId, project.id),
      ),
    )
    .returning()

  if (result.length === 0) return Problems.forbidden()

  recordReviewEvent({
    project_id: project.id,
    target_kind: 'feature',
    target_id: result[0].id,
    action: 'marked',
    user_id: session.user.id,
    user_display: session.user.displayName ?? session.user.email,
    title_snapshot: result[0].name,
  })

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

  const result = await db
    .update(analysisFeatures)
    .set({
      approvedAt: null,
      approvedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(analysisFeatures.id, featureId),
        eq(analysisFeatures.projectId, project.id),
      ),
    )
    .returning()

  if (result.length === 0) return Problems.forbidden()

  recordReviewEvent({
    project_id: project.id,
    target_kind: 'feature',
    target_id: result[0].id,
    action: 'unmarked',
    user_id: session.user.id,
    user_display: session.user.displayName ?? session.user.email,
    title_snapshot: result[0].name,
  })

  return NextResponse.json({ feature: result[0] })
}
