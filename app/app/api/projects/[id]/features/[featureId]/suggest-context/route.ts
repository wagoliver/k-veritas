import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { analysisFeatures, projects } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'
import { runContextSuggestion } from '@/lib/ai/suggest-context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST — a IA analisa o código + metadados da feature e devolve sugestões
 * de contexto (regra de negócio, cenários livres, restrições, env vars).
 * Não persiste nada — o cliente decide o que usar e salva via PATCH.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; featureId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id, featureId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  // Confirma feature pertence ao projeto
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

  // Reusa o mesmo bucket de geração de testes — ambas são chamadas LLM
  // caras no escopo do projeto.
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

  // Carrega project completo pra passar pro runContextSuggestion
  const [fullProject] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, project.id))
    .limit(1)
  if (!fullProject) return Problems.server('project_not_found')

  try {
    const suggestion = await runContextSuggestion(
      fullProject,
      featureId,
      { modelOverride },
    )
    return NextResponse.json({ suggestion })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return Problems.server(`suggest_failed: ${msg}`)
  }
}
