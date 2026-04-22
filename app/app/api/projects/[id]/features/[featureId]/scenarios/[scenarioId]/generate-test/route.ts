import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  analysisFeatures,
  codeAnalysisJobs,
  orgAiConfig,
  projects,
} from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST — enfileira um job do tipo `scenario_test` no kveritas-codex pra
 * gerar UM .spec.ts Playwright pra este cenário específico. Retorna 202
 * com o jobId. A UI faz polling em GET /features pra saber quando o
 * `latestTest` aparece.
 *
 * Pré-requisitos:
 *   - feature pertence ao projeto
 *   - feature está aprovada (approvedAt != null)
 *   - cenário existe dentro de aiScenarios com o id informado
 *   - org tem credencial Anthropic configurada (api_key OU oauth)
 *   - não há outro job scenario_test em voo pro mesmo scenario
 */
export async function POST(
  req: NextRequest,
  ctx: {
    params: Promise<{ id: string; featureId: string; scenarioId: string }>
  },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id, featureId, scenarioId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  if (project.sourceType !== 'repo') {
    return Problems.invalidBody({ source: 'source_not_configured' })
  }
  const hasSource = project.repoUrl !== null || project.repoZipPath !== null
  if (!hasSource) {
    return Problems.invalidBody({ source: 'source_not_configured' })
  }

  const rl = await consumeToken(BUCKETS.aiGenerateTests(project.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  // Valida feature: pertence ao projeto, está aprovada, cenário existe.
  const [feature] = await db
    .select({
      id: analysisFeatures.id,
      approvedAt: analysisFeatures.approvedAt,
      aiScenarios: analysisFeatures.aiScenarios,
    })
    .from(analysisFeatures)
    .where(
      and(
        eq(analysisFeatures.id, featureId),
        eq(analysisFeatures.projectId, project.id),
      ),
    )
    .limit(1)
  if (!feature) return Problems.forbidden()
  if (!feature.approvedAt) {
    return Problems.conflict(
      'feature_not_approved',
      'Aprove a feature na tela Estrutura antes de gerar testes dos seus cenários.',
    )
  }

  const scenarios = Array.isArray(feature.aiScenarios)
    ? (feature.aiScenarios as Array<{
        id?: string
        description?: string
      }>)
    : []
  const scenario = scenarios.find((s) => s.id === scenarioId)
  if (!scenario) return Problems.forbidden()

  // Pré-check credencial Anthropic — mesma regra do code-analysis
  // principal (codex/src/db.ts#resolveAnthropic).
  const [aiCfg] = await db
    .select({
      provider: orgAiConfig.provider,
      apiKeyEncrypted: orgAiConfig.apiKeyEncrypted,
      anthropicApiKeyEncrypted: orgAiConfig.anthropicApiKeyEncrypted,
    })
    .from(orgAiConfig)
    .where(eq(orgAiConfig.orgId, project.orgId))
    .limit(1)

  const hasAnthropic =
    Boolean(aiCfg?.anthropicApiKeyEncrypted) ||
    (aiCfg?.provider === 'anthropic' && Boolean(aiCfg?.apiKeyEncrypted))
  if (!hasAnthropic) {
    return Problems.invalidBody({ anthropicKey: 'anthropic_key_missing' })
  }

  // Model override opcional no body
  let modelOverride: string | null = null
  if (req.headers.get('content-type')?.includes('application/json')) {
    const body = (await req.json().catch(() => null)) as {
      model?: unknown
    } | null
    if (body && typeof body.model === 'string') {
      const trimmed = body.model.trim()
      if (trimmed.length > 0 && trimmed.length <= 200) {
        modelOverride = trimmed
      }
    }
  }

  const [job] = await db
    .insert(codeAnalysisJobs)
    .values({
      projectId: project.id,
      requestedBy: session.user.id,
      sourceType: 'repo',
      repoUrl: project.repoUrl,
      repoBranch: project.repoBranch,
      repoZipPath: project.repoZipPath,
      status: 'pending',
      phase: 'scenario_test',
      targetFeatureId: featureId,
      targetScenarioId: scenarioId,
      modelOverride,
    })
    .returning({ id: codeAnalysisJobs.id })
  if (!job) return Problems.server()

  return NextResponse.json(
    {
      jobId: job.id,
      status: 'pending',
      featureId,
      scenarioId,
    },
    { status: 202 },
  )
}
