import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { featureFreeScenarios } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { updateFeatureFreeScenarioSchema } from '@/lib/validators/analysis-edit'

export const runtime = 'nodejs'

export async function PATCH(
  req: NextRequest,
  ctx: {
    params: Promise<{ id: string; featureId: string; scenarioId: string }>
  },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id, featureId, scenarioId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const body = await req.json().catch(() => null)
  const parsed = updateFeatureFreeScenarioSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const updates: Record<string, unknown> = {}
  if (parsed.data.description !== undefined)
    updates.description = parsed.data.description
  if (parsed.data.priority !== undefined)
    updates.priority = parsed.data.priority
  if (Object.keys(updates).length === 0) return Problems.invalidBody()

  const result = await db
    .update(featureFreeScenarios)
    .set(updates)
    .where(
      and(
        eq(featureFreeScenarios.id, scenarioId),
        eq(featureFreeScenarios.projectId, project.id),
        eq(featureFreeScenarios.featureId, featureId),
      ),
    )
    .returning({ id: featureFreeScenarios.id })

  if (result.length === 0) return Problems.forbidden()
  return new NextResponse(null, { status: 204 })
}

export async function DELETE(
  _req: NextRequest,
  ctx: {
    params: Promise<{ id: string; featureId: string; scenarioId: string }>
  },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, featureId, scenarioId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  await db
    .delete(featureFreeScenarios)
    .where(
      and(
        eq(featureFreeScenarios.id, scenarioId),
        eq(featureFreeScenarios.projectId, project.id),
        eq(featureFreeScenarios.featureId, featureId),
      ),
    )

  return new NextResponse(null, { status: 204 })
}
