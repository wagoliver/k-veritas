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
  // Anthropic dedicado (code-analysis via Claude Code CLI).
  hasAnthropicKey: boolean
  anthropicModel: string | null
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
    hasAnthropicKey:
      Boolean(row.anthropicApiKeyEncrypted) ||
      (row.provider === 'anthropic' && Boolean(row.apiKeyEncrypted)),
    anthropicModel:
      row.anthropicModel ??
      (row.provider === 'anthropic' ? row.model : null),
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
  // Anthropic dedicado. Semantic idêntica ao apiKey principal:
  //   - anthropicApiKey string → cifra e grava
  //   - clearAnthropicApiKey = true → apaga
  //   - anthropicApiKey undefined + clear false → preserva o existente
  anthropicApiKey?: string | null
  clearAnthropicApiKey?: boolean
  anthropicModel?: string | null
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

  let anthropicApiKeyEncrypted: Buffer | null | undefined
  if (input.clearAnthropicApiKey) {
    anthropicApiKeyEncrypted = null
  } else if (input.anthropicApiKey) {
    anthropicApiKeyEncrypted = encryptApiKey(input.anthropicApiKey)
  } else {
    anthropicApiKeyEncrypted = undefined
  }

  const anthropicModel =
    input.anthropicModel === undefined
      ? undefined
      : input.anthropicModel && input.anthropicModel.length > 0
        ? input.anthropicModel
        : null

  if (!existing) {
    await db.insert(orgAiConfig).values({
      orgId,
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyEncrypted: apiKeyEncrypted ?? null,
      anthropicApiKeyEncrypted: anthropicApiKeyEncrypted ?? null,
      anthropicModel: anthropicModel ?? null,
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
      ...(anthropicApiKeyEncrypted !== undefined
        ? { anthropicApiKeyEncrypted }
        : {}),
      ...(anthropicModel !== undefined ? { anthropicModel } : {}),
      temperature: input.temperature,
      numCtx: input.numCtx,
      timeoutMs: input.timeoutMs,
      updatedBy: userId,
      updatedAt: now,
    })
    .where(eq(orgAiConfig.orgId, orgId))
}
