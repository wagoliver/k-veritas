import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  analysisFeatures,
  featureAiScenarioTests,
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
 *
 * No modelo novo, scenarioId é UUID dentro do jsonb `analysis_features.
 * ai_scenarios`. A gente valida que existe uma feature com esse cenário
 * aprovada e que há teste gerado em feature_ai_scenario_tests.
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

  // Valida que existe teste gerado pra este cenário neste projeto.
  // feature_ai_scenario_tests.scenario_id é TEXT (o UUID do cenário
  // dentro do jsonb) e tem UNIQUE(feature_id, scenario_id), então 1 row
  // por cenário. Se não tem row, não tem teste ainda.
  const [testRow] = await db
    .select({
      id: featureAiScenarioTests.id,
      featureId: featureAiScenarioTests.featureId,
    })
    .from(featureAiScenarioTests)
    .where(
      and(
        eq(featureAiScenarioTests.projectId, project.id),
        eq(featureAiScenarioTests.scenarioId, scenarioId),
      ),
    )
    .limit(1)
  if (!testRow) {
    return Problems.conflict(
      'no_generated_test',
      'Gere o teste Playwright deste cenário antes de executar.',
    )
  }

  // Feature precisa estar aprovada pra rodar — gate consistente com
  // o enqueue de geração.
  const [feature] = await db
    .select({ approvedAt: analysisFeatures.approvedAt })
    .from(analysisFeatures)
    .where(eq(analysisFeatures.id, testRow.featureId))
    .limit(1)
  if (!feature || !feature.approvedAt) {
    return Problems.conflict(
      'feature_not_approved',
      'Aprove a feature na tela Estrutura antes de executar o teste.',
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

  return NextResponse.json(
    { runId: created.id, status: 'pending' },
    {
      status: 202,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
