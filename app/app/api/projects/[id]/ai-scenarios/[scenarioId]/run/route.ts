import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  analysisScenarios,
  scenarioTests,
  testExecRuns,
} from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST — enfileira execução de um único cenário. O runner container
 * polling claimNextJob pega e processa. O front faz polling no detalhe
 * do run pra acompanhar.
 */
export async function POST(
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

  // Confirma que o scenario pertence ao projeto e tem teste gerado
  const [scenario] = await db
    .select({ id: analysisScenarios.id })
    .from(analysisScenarios)
    .where(
      and(
        eq(analysisScenarios.id, scenarioId),
        eq(analysisScenarios.projectId, project.id),
      ),
    )
    .limit(1)
  if (!scenario) return Problems.forbidden()

  const [anyTest] = await db
    .select({ id: scenarioTests.id })
    .from(scenarioTests)
    .where(
      and(
        eq(scenarioTests.projectId, project.id),
        eq(scenarioTests.scenarioIdSnapshot, scenarioId),
      ),
    )
    .limit(1)
  if (!anyTest) {
    return Problems.conflict(
      'no_generated_test',
      'Gere o teste Playwright deste cenário antes de executar.',
    )
  }

  const rl = await consumeToken(BUCKETS.testExecProject(project.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  const [created] = await db
    .insert(testExecRuns)
    .values({
      projectId: project.id,
      scope: 'scenario',
      scopeId: scenarioId,
      status: 'pending',
      requestedBy: session.user.id,
      scenariosCount: 1,
    })
    .returning({ id: testExecRuns.id })

  if (!created) return Problems.server('insert_failed')

  await audit({
    userId: session.user.id,
    event: 'test_exec_enqueued',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: {
      projectId: project.id,
      scenarioId,
      runId: created.id,
      scope: 'scenario',
    },
    outcome: 'success',
  })

  return NextResponse.json({ runId: created.id, status: 'pending' }, {
    status: 202,
    headers: { 'Cache-Control': 'no-store' },
  })
}
