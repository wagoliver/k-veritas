import 'server-only'

import type {
  AIClient,
  AIGenerateOptions,
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

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string }
    finish_reason?: string | null
  }>
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
    // OpenRouter recomenda HTTP-Referer + X-Title pra rate limit melhor,
    // atribuição no dashboard e ranking no leaderboard. Outros providers
    // ignoram esses headers silenciosamente.
    if (this.base().includes('openrouter.ai')) {
      h['HTTP-Referer'] = process.env.APP_URL ?? 'http://localhost:3000'
      h['X-Title'] = 'k-veritas'
    }
    return h
  }

  async generate(
    req: AIGenerateRequest,
    opts: AIGenerateOptions = {},
  ): Promise<AIGenerateResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    const start = Date.now()
    const streaming = Boolean(opts.onProgress)

    try {
      const body: Record<string, unknown> = {
        model: this.config.model,
        temperature: this.config.temperature,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
        stream: streaming,
      }
      if (streaming) {
        // OpenRouter/OpenAI retornam usage no último chunk se pedirmos
        body.stream_options = { include_usage: true }
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
        let detail = raw.slice(0, 500)
        try {
          const parsed = JSON.parse(raw) as { error?: { message?: string } }
          if (parsed?.error?.message) detail = parsed.error.message
        } catch {
          // não era JSON
        }
        throw new AIProviderError(
          `OpenAI-compat ${res.status} ${res.statusText}: ${detail}`,
          res.status,
          raw,
        )
      }

      if (!streaming) {
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
      }

      return await this.readSseStream(res, start, opts.onProgress!)
    } finally {
      clearTimeout(timer)
    }
  }

  private async readSseStream(
    res: Response,
    startMs: number,
    onProgress: NonNullable<AIGenerateOptions['onProgress']>,
  ): Promise<AIGenerateResponse> {
    if (!res.body) throw new AIProviderError('Stream sem body')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let tokensOut = 0
    let tokensIn: number | undefined
    let finalError: string | undefined

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE: mensagens separadas por blank line; cada linha começa com "data: "
        let sepIdx: number
        while ((sepIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, sepIdx).trim()
          buffer = buffer.slice(sepIdx + 1)
          if (!line) continue
          if (!line.startsWith('data:')) continue

          const payload = line.slice(5).trim()
          if (payload === '[DONE]') {
            onProgress({ tokensOut, done: true })
            continue
          }

          let chunk: ChatCompletionChunk
          try {
            chunk = JSON.parse(payload) as ChatCompletionChunk
          } catch {
            continue
          }

          if (chunk.error?.message) finalError = chunk.error.message
          const delta = chunk.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            text += delta
            // Tokens aproximados por # de deltas até a última chunk trazer usage
            tokensOut += 1
            onProgress({ tokensOut, done: false })
          }
          if (chunk.usage) {
            if (typeof chunk.usage.prompt_tokens === 'number') {
              tokensIn = chunk.usage.prompt_tokens
            }
            if (typeof chunk.usage.completion_tokens === 'number') {
              tokensOut = chunk.usage.completion_tokens
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (finalError) throw new AIProviderError(finalError)
    if (!text) throw new AIProviderError('Stream retornou vazio')

    return {
      text,
      tokensIn,
      tokensOut,
      totalDurationMs: Date.now() - startMs,
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
