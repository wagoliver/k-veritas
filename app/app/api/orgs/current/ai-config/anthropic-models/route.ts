import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { orgAiConfig } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { getCurrentOrg } from '@/lib/auth/current-org'
import { Problems } from '@/lib/auth/errors'
import { decryptApiKey } from '@/lib/ai/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/orgs/current/ai-config/anthropic-models
 *
 * Lista os modelos Claude disponíveis pra org consultando
 * `api.anthropic.com/v1/models` com a credencial Anthropic dedicada
 * (ou a do provider principal quando provider=anthropic).
 *
 * Chamado pelo AiConfigForm ao montar — popula o combobox do campo
 * "Modelo Claude" sem listas hardcoded.
 *
 * Em modo OAuth (sk-ant-oat...), o endpoint /v1/models rejeita com
 * 400/401 por design da Anthropic — retornamos reason='oauth_cannot_list'
 * e o frontend cai pra input livre.
 */
export async function GET() {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  const org = await getCurrentOrg(session.user.id)
  if (!org) return Problems.forbidden()

  const [row] = await db
    .select({
      provider: orgAiConfig.provider,
      apiKeyEncrypted: orgAiConfig.apiKeyEncrypted,
      anthropicApiKeyEncrypted: orgAiConfig.anthropicApiKeyEncrypted,
      anthropicAuthMode: orgAiConfig.anthropicAuthMode,
    })
    .from(orgAiConfig)
    .where(eq(orgAiConfig.orgId, org.id))
    .limit(1)

  if (!row) {
    return NextResponse.json(
      { models: [], reason: 'no_config' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const authMode =
    (row.anthropicAuthMode as 'api_key' | 'oauth') ?? 'api_key'

  let apiKey: string | null = null
  if (row.anthropicApiKeyEncrypted) {
    apiKey = decryptApiKey(row.anthropicApiKeyEncrypted)
  } else if (row.provider === 'anthropic' && row.apiKeyEncrypted) {
    apiKey = decryptApiKey(row.apiKeyEncrypted)
  }

  if (!apiKey) {
    return NextResponse.json(
      { models: [], reason: 'no_credential' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (authMode === 'oauth') {
    return NextResponse.json(
      { models: [], reason: 'oauth_cannot_list' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      return NextResponse.json(
        {
          models: [],
          reason: 'anthropic_error',
          status: res.status,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    const models = (data.data ?? [])
      .map((m) => m.id)
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .sort()
    return NextResponse.json(
      { models },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return NextResponse.json(
      {
        models: [],
        reason: 'fetch_error',
        error: err instanceof Error ? err.message : 'unknown',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
