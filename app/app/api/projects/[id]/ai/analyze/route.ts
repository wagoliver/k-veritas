import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq, lt, sql } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { projectAnalyses } from '@/lib/db/schema'

const STALE_THRESHOLD_MS = 15 * 60 * 1000
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'
import { runProjectAnalysis } from '@/lib/ai/analyze'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600

/**
 * GET — retorna a análise mais recente do projeto.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const [latest] = await db
    .select()
    .from(projectAnalyses)
    .where(eq(projectAnalyses.projectId, project.id))
    .orderBy(desc(projectAnalyses.createdAt))
    .limit(1)

  if (!latest) return NextResponse.json({ analysis: null })

  return NextResponse.json(
    {
      analysis: {
        id: latest.id,
        status: latest.status,
        model: latest.model,
        provider: latest.provider,
        summary: latest.summary,
        inferredLocale: latest.inferredLocale,
        features: latest.features,
        error: latest.error,
        tokensIn: latest.tokensIn,
        tokensOut: latest.tokensOut,
        durationMs: latest.durationMs,
        startedAt: latest.startedAt,
        finishedAt: latest.finishedAt,
        createdAt: latest.createdAt,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * POST — dispara uma nova análise (síncrono, espera Ollama responder).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const rl = await consumeToken({
    key: `ai:analyze:${project.id}`,
    capacity: 5,
    refillPerSecond: 5 / 3600,
  })
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  // Qualquer linha running parada há mais de STALE_THRESHOLD_MS é considerada
  // morta (worker travou, container reiniciou, Ollama nunca respondeu) e marcada
  // como failed — senão o projeto fica trancado com 409 eternamente.
  const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MS)
  await db
    .update(projectAnalyses)
    .set({
      status: 'failed',
      error: 'stale_timeout: análise abandonada (>15min sem heartbeat)',
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(projectAnalyses.projectId, project.id),
        eq(projectAnalyses.status, 'running'),
        lt(
          sql`COALESCE(${projectAnalyses.startedAt}, ${projectAnalyses.createdAt})`,
          staleBefore,
        ),
      ),
    )

  // Bloqueia se ainda há análise rodando recente
  const [running] = await db
    .select({ id: projectAnalyses.id })
    .from(projectAnalyses)
    .where(
      and(
        eq(projectAnalyses.projectId, project.id),
        eq(projectAnalyses.status, 'running'),
      ),
    )
    .limit(1)
  if (running) {
    return Problems.conflict(
      'analysis_already_running',
      'Já existe uma análise em andamento.',
    )
  }

  try {
    const outcome = await runProjectAnalysis(project, session.user.id)

    await audit({
      userId: session.user.id,
      event:
        outcome.status === 'completed'
          ? 'ai_analyze_success'
          : 'ai_analyze_failure',
      ip: clientIp(req),
      userAgent: userAgent(req),
      meta: {
        projectId: project.id,
        analysisId: outcome.analysisId,
        durationMs: outcome.durationMs,
        tokensIn: outcome.tokensIn,
        tokensOut: outcome.tokensOut,
      },
      outcome: outcome.status === 'completed' ? 'success' : 'failure',
    })

    return NextResponse.json(outcome, {
      status: outcome.status === 'completed' ? 200 : 500,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    if (message === 'no_crawl_available') {
      return Problems.conflict(
        'no_crawl_available',
        'Faça um crawl primeiro antes de analisar.',
      )
    }
    return Problems.server(message)
  }
}
