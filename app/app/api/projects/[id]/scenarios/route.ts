import { NextResponse, type NextRequest } from 'next/server'
import { asc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { projectScenarios } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { createScenarioSchema } from '@/lib/validators/project'

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
    .select()
    .from(projectScenarios)
    .where(eq(projectScenarios.projectId, project.id))
    .orderBy(asc(projectScenarios.priority), asc(projectScenarios.createdAt))

  return NextResponse.json({ items })
}

export async function POST(
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
  const parsed = createScenarioSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const [row] = await db
    .insert(projectScenarios)
    .values({
      projectId: project.id,
      description: parsed.data.description,
      priority: parsed.data.priority,
    })
    .returning()

  return NextResponse.json(row, { status: 201 })
}
