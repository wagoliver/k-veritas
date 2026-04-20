import { NextResponse, type NextRequest } from 'next/server'

import { getServerSession } from '@/lib/auth/session'
import { getCurrentOrg } from '@/lib/auth/current-org'
import { Problems } from '@/lib/auth/errors'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'
import { getOrgAiConfigView, upsertOrgAiConfig } from '@/lib/ai/config'
import { aiConfigInputSchema } from '@/lib/validators/ai-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const org = await getCurrentOrg(session.user.id)
  if (!org) return Problems.forbidden()

  const config = await getOrgAiConfigView(org.id)
  return NextResponse.json(
    { config },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const org = await getCurrentOrg(session.user.id)
  if (!org) return Problems.forbidden()
  if (org.role !== 'owner' && org.role !== 'admin') return Problems.forbidden()

  const rl = await consumeToken(BUCKETS.aiConfigWrite(org.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  const body = await req.json().catch(() => null)
  const parsed = aiConfigInputSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const hasApiKey = Boolean(parsed.data.apiKey && parsed.data.apiKey.length > 0)
  const hasAnthropicApiKey = Boolean(
    parsed.data.anthropicApiKey && parsed.data.anthropicApiKey.length > 0,
  )

  await upsertOrgAiConfig(org.id, session.user.id, {
    provider: parsed.data.provider,
    baseUrl: parsed.data.baseUrl,
    model: parsed.data.model,
    apiKey: hasApiKey ? parsed.data.apiKey : undefined,
    clearApiKey: parsed.data.clearApiKey,
    temperature: parsed.data.temperature,
    numCtx: parsed.data.numCtx,
    timeoutMs: parsed.data.timeoutMs,
    anthropicApiKey: hasAnthropicApiKey
      ? parsed.data.anthropicApiKey
      : undefined,
    clearAnthropicApiKey: parsed.data.clearAnthropicApiKey,
    anthropicModel:
      parsed.data.anthropicModel === ''
        ? null
        : parsed.data.anthropicModel,
  })

  await audit({
    userId: session.user.id,
    event: 'ai_config_updated',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: {
      orgId: org.id,
      provider: parsed.data.provider,
      model: parsed.data.model,
      hasApiKey,
      hasAnthropicApiKey,
    },
    outcome: 'success',
  })

  const config = await getOrgAiConfigView(org.id)
  return NextResponse.json({ config })
}
