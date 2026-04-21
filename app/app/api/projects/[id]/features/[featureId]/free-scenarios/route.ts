import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { analysisFeatures, featureFreeScenarios } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { createFeatureFreeScenarioSchema } from '@/lib/validators/analysis-edit'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; featureId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, featureId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  // Garante que a feature pertence ao projeto da sessão — previne IDOR.
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

  const items = await db
    .select()
    .from(featureFreeScenarios)
    .where(eq(featureFreeScenarios.featureId, featureId))
    .orderBy(
      asc(featureFreeScenarios.priority),
      asc(featureFreeScenarios.createdAt),
    )

  return NextResponse.json({ items })
}

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
  const parsed = createFeatureFreeScenarioSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const [row] = await db
    .insert(featureFreeScenarios)
    .values({
      projectId: project.id,
      featureId,
      description: parsed.data.description,
      priority: parsed.data.priority,
    })
    .returning()

  return NextResponse.json(row, { status: 201 })
}
