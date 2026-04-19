import 'server-only'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  orgAiConfig,
  type AIProvider,
  type OrgAiConfig,
} from '@/lib/db/schema'
import { decryptApiKey, encryptApiKey } from './crypto'
import type { AIProviderConfig } from './types'

const DEFAULT_TEMPERATURE = 0.3
const DEFAULT_NUM_CTX = 16384
const DEFAULT_TIMEOUT_MS = 300_000

export interface SavedOrgAiConfig {
  provider: AIProvider
  baseUrl: string
  model: string
  hasApiKey: boolean
  temperature: number
  numCtx: number
  timeoutMs: number
  updatedAt: Date
  updatedBy: string
}

export async function getOrgAiConfigRow(
  orgId: string,
): Promise<OrgAiConfig | null> {
  const [row] = await db
    .select()
    .from(orgAiConfig)
    .where(eq(orgAiConfig.orgId, orgId))
    .limit(1)
  return row ?? null
}

export async function getOrgAiConfigView(
  orgId: string,
): Promise<SavedOrgAiConfig | null> {
  const row = await getOrgAiConfigRow(orgId)
  if (!row) return null
  return {
    provider: row.provider as AIProvider,
    baseUrl: row.baseUrl,
    model: row.model,
    hasApiKey: Boolean(row.apiKeyEncrypted),
    temperature: row.temperature,
    numCtx: row.numCtx,
    timeoutMs: row.timeoutMs,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

/**
 * Resolve a config efetiva: config da org > env vars (dev/bootstrap).
 * Quando a org não tem config, usa AI_PROVIDER/OLLAMA_URL/OLLAMA_MODEL/etc
 * como fallback — permite rodar antes do onboarding.
 */
export async function resolveAiConfig(
  orgId: string,
): Promise<AIProviderConfig> {
  const row = await getOrgAiConfigRow(orgId)

  if (row) {
    return {
      provider: row.provider as AIProvider,
      baseUrl: row.baseUrl,
      model: row.model,
      apiKey: row.apiKeyEncrypted
        ? decryptApiKey(row.apiKeyEncrypted)
        : undefined,
      temperature: row.temperature,
      numCtx: row.numCtx,
      timeoutMs: row.timeoutMs,
    }
  }

  return {
    provider: (process.env.AI_PROVIDER as AIProvider) ?? 'ollama',
    baseUrl: process.env.OLLAMA_URL ?? 'http://ollama:11434',
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:14b',
    apiKey: undefined,
    temperature: Number(process.env.OLLAMA_TEMPERATURE ?? DEFAULT_TEMPERATURE),
    numCtx: Number(process.env.OLLAMA_NUM_CTX ?? DEFAULT_NUM_CTX),
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  }
}

export interface UpsertAiConfigInput {
  provider: AIProvider
  baseUrl: string
  model: string
  apiKey?: string | null
  clearApiKey?: boolean
  temperature: number
  numCtx: number
  timeoutMs: number
}

export async function upsertOrgAiConfig(
  orgId: string,
  userId: string,
  input: UpsertAiConfigInput,
): Promise<void> {
  const now = new Date()
  const existing = await getOrgAiConfigRow(orgId)

  let apiKeyEncrypted: Buffer | null | undefined
  if (input.clearApiKey) {
    apiKeyEncrypted = null
  } else if (input.apiKey) {
    apiKeyEncrypted = encryptApiKey(input.apiKey)
  } else {
    apiKeyEncrypted = undefined
  }

  if (!existing) {
    await db.insert(orgAiConfig).values({
      orgId,
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyEncrypted: apiKeyEncrypted ?? null,
      temperature: input.temperature,
      numCtx: input.numCtx,
      timeoutMs: input.timeoutMs,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    return
  }

  await db
    .update(orgAiConfig)
    .set({
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      ...(apiKeyEncrypted !== undefined ? { apiKeyEncrypted } : {}),
      temperature: input.temperature,
      numCtx: input.numCtx,
      timeoutMs: input.timeoutMs,
      updatedBy: userId,
      updatedAt: now,
    })
    .where(eq(orgAiConfig.orgId, orgId))
}
