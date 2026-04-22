import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { featureAiScenarioTests, projects } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'
import { runScenarioTestGeneration } from '@/lib/ai/generate-scenario-test'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

/**
 * POST — gera (ou regera) o .spec.ts Playwright pra um cenário específico
 * da feature. Usa o provider primário da org (Ollama/Anthropic) via client
 * factory — mesmo caminho do suggest-context.
 *
 * Pré-requisitos:
 *   - feature deve pertencer ao projeto
 *   - feature deve estar aprovada (approvedAt != null)
 *   - scenarioId deve existir dentro do aiScenarios da feature
 *
 * Regeneração: UPSERT no feature_ai_scenario_tests por (feature_id, scenario_id).
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

  const rl = await consumeToken(BUCKETS.aiGenerateTests(project.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  // Model override opcional no body
  let modelOverride: string | undefined
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

  // Carrega project completo pra passar pro runScenarioTestGeneration
  const [fullProject] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, project.id))
    .limit(1)
  if (!fullProject) return Problems.server('project_not_found')

  try {
    const result = await runScenarioTestGeneration(
      fullProject,
      featureId,
      scenarioId,
      { modelOverride },
    )

    // Upsert: uma linha por (feature_id, scenario_id). Regenerar atualiza.
    const [saved] = await db
      .insert(featureAiScenarioTests)
      .values({
        projectId: project.id,
        featureId,
        scenarioId,
        code: result.code,
        model: result.model,
        provider: result.provider,
        tokensIn: result.tokensIn ?? null,
        tokensOut: result.tokensOut ?? null,
        createdBy: session.user.id,
      })
      .onConflictDoUpdate({
        target: [
          featureAiScenarioTests.featureId,
          featureAiScenarioTests.scenarioId,
        ],
        set: {
          code: result.code,
          model: result.model,
          provider: result.provider,
          tokensIn: result.tokensIn ?? null,
          tokensOut: result.tokensOut ?? null,
          createdBy: session.user.id,
          createdAt: new Date(),
        },
      })
      .returning()

    return NextResponse.json({
      test: {
        id: saved.id,
        code: saved.code,
        model: saved.model,
        provider: saved.provider,
        createdAt: saved.createdAt,
        createdBy: saved.createdBy,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error(
      `[generate-scenario-test] feature=${featureId} scenario=${scenarioId} failed:`,
      msg,
      err instanceof Error ? err.stack : undefined,
    )
    if (msg === 'feature_not_approved') {
      return Problems.conflict(
        'feature_not_approved',
        'Aprove a feature na tela Estrutura antes de gerar testes dos seus cenários.',
      )
    }
    if (msg === 'scenario_not_found' || msg === 'feature_not_found') {
      return Problems.forbidden()
    }
    return Problems.server(`generate_failed: ${msg}`)
  }
}
