import { NextResponse, type NextRequest } from 'next/server'

import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'
import { runTestGeneration } from '@/lib/ai/generate-tests'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600

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

  const rl = await consumeToken(BUCKETS.aiGenerateTests(project.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

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

  try {
    const outcome = await runTestGeneration(project, session.user.id, {
      modelOverride,
    })

    await audit({
      userId: session.user.id,
      event:
        outcome.status === 'completed'
          ? 'ai_generate_tests_success'
          : 'ai_generate_tests_failure',
      ip: clientIp(req),
      userAgent: userAgent(req),
      meta: {
        projectId: project.id,
        testRunId: outcome.testRunId,
        filesCount: outcome.filesCount,
        scenariosCount: outcome.scenariosCount,
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
    if (message === 'no_reviewed_scenarios') {
      return Problems.conflict(
        'no_reviewed_scenarios',
        'Marque ao menos um cenário como revisado antes de gerar testes.',
      )
    }
    return Problems.server(message)
  }
}
