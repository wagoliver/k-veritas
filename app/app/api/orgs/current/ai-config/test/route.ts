import { NextResponse, type NextRequest } from 'next/server'

import { getServerSession } from '@/lib/auth/session'
import { getCurrentOrg } from '@/lib/auth/current-org'
import { Problems } from '@/lib/auth/errors'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'
import { buildClient } from '@/lib/ai/client-factory'
import { getOrgAiConfigRow } from '@/lib/ai/config'
import { decryptApiKey } from '@/lib/ai/crypto'
import { aiConfigTestSchema } from '@/lib/validators/ai-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
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

  const rl = await consumeToken(BUCKETS.aiConfigTest(org.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  const body = await req.json().catch(() => null)
  const parsed = aiConfigTestSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  let apiKey: string | undefined
  if (parsed.data.useSavedApiKey) {
    const row = await getOrgAiConfigRow(org.id)
    if (row?.apiKeyEncrypted) apiKey = decryptApiKey(row.apiKeyEncrypted)
  } else if (parsed.data.apiKey) {
    apiKey = parsed.data.apiKey
  }

  const client = buildClient({
    provider: parsed.data.provider,
    baseUrl: parsed.data.baseUrl,
    model: 'probe',
    apiKey,
    temperature: 0,
    numCtx: 4096,
    timeoutMs: 10_000,
  })

  const ping = await client.ping()
  if (!ping.ok) {
    return NextResponse.json(
      { ok: false, error: ping.error ?? 'connection_failed', models: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // Ping passou mas listModels pode falhar por parse/conteúdo inesperado.
  // Propagamos a mensagem do AIProviderError pra UI em vez de engolir e
  // mostrar "0 modelos disponíveis" sem pista do motivo.
  try {
    const models = await client.listModels()
    return NextResponse.json(
      {
        ok: true,
        latencyMs: ping.latencyMs,
        models: models.map((m) => m.name).sort(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json(
      {
        ok: false,
        error: `Conexão OK mas listModels falhou: ${msg}`,
        latencyMs: ping.latencyMs,
        models: [],
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
