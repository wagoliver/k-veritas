import 'server-only'

import type {
  AIClient,
  AIGenerateOptions,
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
  done?: boolean
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

  async generate(
    req: AIGenerateRequest,
    opts: AIGenerateOptions = {},
  ): Promise<AIGenerateResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    const streaming = Boolean(opts.onProgress)

    try {
      const res = await fetch(`${this.base()}/api/generate`, {
        method: 'POST',
        headers: this.headers(),
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          system: req.system,
          prompt: req.prompt,
          stream: streaming,
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
        // Ollama devolve JSON com { error: "..." } no corpo. Extrai a mensagem
        // pra cair no error do project_analyses e virar toast legível.
        let detail = raw.slice(0, 500)
        try {
          const parsed = JSON.parse(raw) as { error?: string }
          if (parsed?.error) detail = parsed.error
        } catch {
          // raw não era JSON — mantém o texto bruto truncado
        }
        throw new AIProviderError(
          `Ollama ${res.status} ${res.statusText}: ${detail}`,
          res.status,
          raw,
        )
      }

      if (!streaming) {
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
      }

      return await this.readStream(res, opts.onProgress!)
    } finally {
      clearTimeout(timer)
    }
  }

  private async readStream(
    res: Response,
    onProgress: NonNullable<AIGenerateOptions['onProgress']>,
  ): Promise<AIGenerateResponse> {
    if (!res.body) throw new AIProviderError('Ollama stream sem body')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let tokensOut = 0
    let tokensIn: number | undefined
    let totalDurationMs: number | undefined
    let finalError: string | undefined

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let lineEnd: number
        while ((lineEnd = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, lineEnd).trim()
          buffer = buffer.slice(lineEnd + 1)
          if (!line) continue

          let chunk: OllamaGenerateApiResponse
          try {
            chunk = JSON.parse(line) as OllamaGenerateApiResponse
          } catch {
            continue
          }

          if (chunk.error) finalError = chunk.error
          if (typeof chunk.response === 'string' && chunk.response.length > 0) {
            text += chunk.response
            tokensOut += 1
            onProgress({ tokensOut, done: false })
          }
          if (chunk.done) {
            tokensIn = chunk.prompt_eval_count
            if (typeof chunk.eval_count === 'number') {
              tokensOut = chunk.eval_count
            }
            totalDurationMs = chunk.total_duration
              ? Math.round(chunk.total_duration / 1_000_000)
              : undefined
            onProgress({ tokensOut, done: true })
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (finalError) throw new AIProviderError(finalError)
    if (!text) throw new AIProviderError('Ollama stream retornou vazio')

    return { text, tokensIn, tokensOut, totalDurationMs }
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
