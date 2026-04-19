import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, max } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { analysisFeatures, analysisScenarios } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { createScenarioSchema } from '@/lib/validators/analysis-edit'
import { recomputeFeatureReviewed } from '@/lib/ai/feature-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST — cria cenário manual em uma feature existente.
 */
export async function POST(
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

  // Confirma que a feature pertence ao projeto
  const [feature] = await db
    .select({ id: analysisFeatures.id })
    .from(analysisFeatures)
    .where(
      and(
        eq(analysisFeatures.id, featureId),
        eq(analysisFeatures.projectId, project.id),
      ),
    )
    .limit(1)
  if (!feature) return Problems.forbidden()

  const body = await req.json().catch(() => null)
  const parsed = createScenarioSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const [maxRow] = await db
    .select({ value: max(analysisScenarios.sortOrder) })
    .from(analysisScenarios)
    .where(eq(analysisScenarios.featureId, featureId))
  const nextOrder = (maxRow?.value ?? -1) + 1

  const [created] = await db
    .insert(analysisScenarios)
    .values({
      featureId,
      projectId: project.id,
      title: parsed.data.title,
      rationale: parsed.data.rationale,
      priority: parsed.data.priority,
      preconditions: parsed.data.preconditions,
      dataNeeded: parsed.data.dataNeeded,
      sortOrder: nextOrder,
      source: 'manual',
    })
    .returning()

  // Novo scenario é unreviewed por default → feature deixa de ser "totalmente
  // revisada" se era. Recomputa.
  await recomputeFeatureReviewed(featureId, session.user.id)

  return NextResponse.json({ scenario: created }, { status: 201 })
}
