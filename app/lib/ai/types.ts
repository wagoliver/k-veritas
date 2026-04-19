import 'server-only'

import type { AIProvider } from '@/lib/db/schema'

export interface AIProviderConfig {
  provider: AIProvider
  baseUrl: string
  model: string
  apiKey?: string
  temperature: number
  numCtx: number
  timeoutMs: number
}

export interface AIGenerateRequest {
  system: string
  prompt: string
  format?: 'json'
}

export interface AIGenerateResponse {
  text: string
  tokensIn?: number
  tokensOut?: number
  totalDurationMs?: number
}

export interface AIStreamProgress {
  tokensOut: number
  done: boolean
}

export interface AIGenerateOptions {
  /**
   * Se fornecido, a geração usa streaming e chama este callback
   * conforme os tokens vão chegando (throttled pelo chamador).
   */
  onProgress?: (p: AIStreamProgress) => void
}

export interface AIClient {
  readonly config: AIProviderConfig
  generate(
    req: AIGenerateRequest,
    opts?: AIGenerateOptions,
  ): Promise<AIGenerateResponse>
  listModels(): Promise<Array<{ name: string; size?: number }>>
  ping(): Promise<{ ok: boolean; error?: string; latencyMs?: number }>
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
    public raw?: string,
  ) {
    super(message)
    this.name = 'AIProviderError'
  }
}
