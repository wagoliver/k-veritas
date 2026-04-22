import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { featureAiScenarioTests } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * No modelo novo, `feature_ai_scenario_tests` tem UNIQUE(feature_id,
 * scenario_id), então só existe 1 row por cenário — o último gerado.
 * Regenerar (via POST /generate-test) faz upsert no lugar.
 *
 * GET retorna o teste atual (ou array vazio se não há). A UI pode
 * continuar tratando como lista.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; scenarioId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, scenarioId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const rows = await db
    .select({
      id: featureAiScenarioTests.id,
      code: featureAiScenarioTests.code,
      model: featureAiScenarioTests.model,
      provider: featureAiScenarioTests.provider,
      createdAt: featureAiScenarioTests.createdAt,
    })
    .from(featureAiScenarioTests)
    .where(
      and(
        eq(featureAiScenarioTests.projectId, project.id),
        eq(featureAiScenarioTests.scenarioId, scenarioId),
      ),
    )
    .limit(1)

  return NextResponse.json(
    {
      tests: rows.map((r) => ({
        id: r.id,
        code: r.code,
        titleSnapshot: null,
        filePath: null,
        createdAt: r.createdAt,
        testRunId: null,
        runStatus: 'completed',
        runProvider: r.provider,
        runModel: r.model,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * DELETE — apaga o teste gerado deste cenário. O próximo "Gerar"
 * produz um teste novo do zero.
 */
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
    .delete(featureAiScenarioTests)
    .where(
      and(
        eq(featureAiScenarioTests.projectId, project.id),
        eq(featureAiScenarioTests.scenarioId, scenarioId),
      ),
    )
    .returning({ id: featureAiScenarioTests.id })

  await audit({
    userId: session.user.id,
    event: 'scenario_test_deleted',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: {
      projectId: project.id,
      scenarioId,
      deletedCount: deleted.length,
    },
    outcome: 'success',
  })

  return NextResponse.json(
    { deletedCount: deleted.length },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * PATCH — edita o código do teste atual. Usado pelo edit-per-step
 * inline: a UI calcula o code completo com a linha substituída e manda
 * aqui. Atualização in-place (só 1 row por cenário).
 */
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

  const body = (await req.json().catch(() => null)) as {
    code?: unknown
  } | null
  if (!body || typeof body.code !== 'string' || body.code.length < 10) {
    return Problems.invalidBody()
  }
  if (body.code.length > 100_000) return Problems.invalidBody()

  const updated = await db
    .update(featureAiScenarioTests)
    .set({ code: body.code })
    .where(
      and(
        eq(featureAiScenarioTests.projectId, project.id),
        eq(featureAiScenarioTests.scenarioId, scenarioId),
      ),
    )
    .returning({ id: featureAiScenarioTests.id })

  if (updated.length === 0) {
    return Problems.conflict(
      'no_test_to_edit',
      'Este cenário não tem teste gerado pra editar.',
    )
  }

  await audit({
    userId: session.user.id,
    event: 'scenario_test_edited',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: {
      projectId: project.id,
      scenarioId,
      testId: updated[0].id,
      codeBytes: body.code.length,
    },
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
