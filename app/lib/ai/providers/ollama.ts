import 'server-only'

import type {
  AIClient,
  AIGenerateRequest,
  AIGenerateResponse,
  AIProviderConfig,
} from '../types'
import { AIProviderError } from '../types'

interface OllamaTagResponse {
  models?: Array<{ name: string; size?: number }>
}

interface OllamaGenerateApiResponse {
  response?: string
  prompt_eval_count?: number
  eval_count?: number
  total_duration?: number
  error?: string
}

export class OllamaClient implements AIClient {
  constructor(public readonly config: AIProviderConfig) {}

  private base(): string {
    return this.config.baseUrl.replace(/\/$/, '')
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.config.apiKey) h.Authorization = `Bearer ${this.config.apiKey}`
    return h
  }

  async generate(req: AIGenerateRequest): Promise<AIGenerateResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      const res = await fetch(`${this.base()}/api/generate`, {
        method: 'POST',
        headers: this.headers(),
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          system: req.system,
          prompt: req.prompt,
          stream: false,
          format: req.format ?? 'json',
          keep_alive: '1h',
          options: {
            temperature: this.config.temperature,
            num_ctx: this.config.numCtx,
          },
        }),
      })

      if (!res.ok) {
        const raw = await res.text().catch(() => '')
        throw new AIProviderError(
          `Ollama ${res.status} ${res.statusText}`,
          res.status,
          raw,
        )
      }

      const data = (await res.json()) as OllamaGenerateApiResponse
      if (!data.response || typeof data.response !== 'string') {
        throw new AIProviderError(
          data.error ?? 'Ollama retornou resposta vazia',
        )
      }

      return {
        text: data.response,
        tokensIn: data.prompt_eval_count,
        tokensOut: data.eval_count,
        totalDurationMs: data.total_duration
          ? Math.round(data.total_duration / 1_000_000)
          : undefined,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async listModels(): Promise<Array<{ name: string; size?: number }>> {
    try {
      const res = await fetch(`${this.base()}/api/tags`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return []
      const data = (await res.json()) as OllamaTagResponse
      return data.models ?? []
    } catch {
      return []
    }
  }

  async ping(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const start = Date.now()
    try {
      const res = await fetch(`${this.base()}/api/tags`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status} ${res.statusText}` }
      }
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'unknown',
      }
    }
  }
}
