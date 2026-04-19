import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { projectTestRuns, scenarioTests } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'
import { sql } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — histórico de testes gerados pra um scenario específico.
 * Mais recente primeiro. Útil pra ver versões anteriores do código.
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
      id: scenarioTests.id,
      code: scenarioTests.code,
      titleSnapshot: scenarioTests.titleSnapshot,
      filePath: scenarioTests.filePath,
      createdAt: scenarioTests.createdAt,
      testRunId: scenarioTests.testRunId,
      runStatus: projectTestRuns.status,
      runProvider: projectTestRuns.provider,
      runModel: projectTestRuns.model,
    })
    .from(scenarioTests)
    .innerJoin(
      projectTestRuns,
      eq(projectTestRuns.id, scenarioTests.testRunId),
    )
    .where(
      and(
        eq(scenarioTests.projectId, project.id),
        eq(scenarioTests.scenarioIdSnapshot, scenarioId),
      ),
    )
    .orderBy(desc(scenarioTests.createdAt))
    .limit(20)

  return NextResponse.json(
    { tests: rows },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * DELETE — apaga TODOS os testes gerados pra esse scenario.
 * O scenario volta a ser "candidato" (aparece apagado na aba Cenários de
 * Teste). O próximo "Gerar" produz um teste novo do zero.
 *
 * project_test_runs em si não são apagados — eles são o histórico de
 * rodadas e guardam custo/tokens/duração pra auditoria.
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
    .delete(scenarioTests)
    .where(
      and(
        eq(scenarioTests.projectId, project.id),
        eq(scenarioTests.scenarioIdSnapshot, scenarioId),
      ),
    )
    .returning({ id: scenarioTests.id })

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
 * PATCH — edita o código da última versão do teste desse cenário.
 * Usado pelo edit-per-step inline: a UI calcula o code completo com a
 * linha substituída e manda aqui.
 *
 * Atualiza em-place (não cria nova linha no histórico). Pra restaurar
 * o código original, regere o teste (trash + "Gerar").
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

  // Atualiza apenas o scenario_tests mais recente daquele scenario.
  const result = await db.execute<{ id: string }>(sql`
    UPDATE scenario_tests
    SET code = ${body.code}
    WHERE id = (
      SELECT id FROM scenario_tests
      WHERE project_id = ${project.id}
        AND scenario_id_snapshot = ${scenarioId}
      ORDER BY created_at DESC
      LIMIT 1
    )
    RETURNING id
  `)

  if (result.length === 0) {
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
      testId: result[0].id,
      codeBytes: body.code.length,
    },
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
