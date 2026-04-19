import 'server-only'

import type {
  AIClient,
  AIGenerateRequest,
  AIGenerateResponse,
  AIProviderConfig,
} from '../types'
import { AIProviderError } from '../types'

/**
 * Cliente para APIs compatíveis com OpenAI: LM Studio, llama.cpp server,
 * Jan, vLLM, LocalAI, OpenAI-oficial, OpenRouter, Groq, etc.
 *
 * Endpoints: POST /v1/chat/completions  + GET /v1/models
 */

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

interface ModelListResponse {
  data?: Array<{ id: string }>
}

export class OpenAICompatibleClient implements AIClient {
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
    const start = Date.now()

    try {
      const body: Record<string, unknown> = {
        model: this.config.model,
        temperature: this.config.temperature,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
        stream: false,
      }
      if (req.format === 'json') {
        body.response_format = { type: 'json_object' }
      }

      const res = await fetch(`${this.base()}/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        signal: controller.signal,
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const raw = await res.text().catch(() => '')
        throw new AIProviderError(
          `OpenAI-compat ${res.status} ${res.statusText}`,
          res.status,
          raw,
        )
      }

      const data = (await res.json()) as ChatCompletionResponse
      const text = data.choices?.[0]?.message?.content ?? ''
      if (!text || typeof text !== 'string') {
        throw new AIProviderError(
          data.error?.message ?? 'Provider retornou resposta vazia',
        )
      }

      return {
        text,
        tokensIn: data.usage?.prompt_tokens,
        tokensOut: data.usage?.completion_tokens,
        totalDurationMs: Date.now() - start,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async listModels(): Promise<Array<{ name: string; size?: number }>> {
    const primary = await this.fetchModels('/v1/models')
    if (primary.length > 0) return primary
    // Fallback específico do LM Studio: lista modelos baixados mesmo
    // que não estejam carregados em memória. Em providers que não são
    // LM Studio, esse endpoint responde 404 e o retorno fica vazio.
    return this.fetchModels('/api/v0/models')
  }

  private async fetchModels(
    path: string,
  ): Promise<Array<{ name: string; size?: number }>> {
    try {
      const res = await fetch(`${this.base()}${path}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return []
      const data = (await res.json()) as ModelListResponse
      return (data.data ?? [])
        .map((m) => ({ name: m.id }))
        .filter((m) => typeof m.name === 'string' && m.name.length > 0)
    } catch {
      return []
    }
  }

  async ping(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const start = Date.now()
    try {
      const res = await fetch(`${this.base()}/v1/models`, {
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
