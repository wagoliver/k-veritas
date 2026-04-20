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
    // Normaliza: remove trailing slash e remove /v1 no fim se o usuário colou
    // a base URL "completa" (ex.: https://api.anthropic.com/v1). Nosso código
    // sempre anexa /v1/... nos paths, sem isso resultaria em /v1/v1/...
    return this.config.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '')
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    const base = this.base()

    if (this.config.apiKey) {
      h.Authorization = `Bearer ${this.config.apiKey}`
      // Anthropic aceita Bearer em /v1/chat/completions mas exige x-api-key
      // em /v1/models (endpoint nativo). Mandar os dois cobre os dois casos.
      if (base.includes('anthropic.com')) {
        h['x-api-key'] = this.config.apiKey
        h['anthropic-version'] = '2023-06-01'
      }
    }

    // OpenRouter recomenda HTTP-Referer + X-Title pra rate limit melhor,
    // atribuição no dashboard e ranking no leaderboard. Outros providers
    // ignoram esses headers silenciosamente.
    if (base.includes('openrouter.ai')) {
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
        // Anthropic rejeita response_format.type='json_object' (só aceita
        // 'json_schema'). O ANALYSIS_SYSTEM_PROMPT já explicita o schema e
        // pede JSON puro; o sanitizeJsonResponse corta fences eventuais.
        // Omitir response_format é mais simples e funciona.
        if (!this.base().includes('anthropic.com')) {
          body.response_format = { type: 'json_object' }
        }
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
    if (primary.models.length > 0) return primary.models
    // Fallback específico do LM Studio: lista modelos baixados mesmo
    // que não estejam carregados em memória. Em providers que não são
    // LM Studio, esse endpoint responde 404 e o retorno fica vazio.
    const fallback = await this.fetchModels('/api/v0/models')
    if (fallback.models.length > 0) return fallback.models

    // Nenhum endpoint devolveu modelos. Anexa um diagnóstico na mensagem
    // do erro que o test/route.ts pode propagar pra UI.
    const reason = primary.diagnostic ?? fallback.diagnostic ?? 'empty response'
    throw new AIProviderError(
      `listModels falhou em /v1/models (${reason}). Veja logs do container app pra mais detalhes.`,
    )
  }

  // Retorna tanto a lista de modelos quanto um diagnóstico (quando
  // aplicável) pra propagar informação útil pra UI. Nunca throwa.
  private async fetchModels(
    path: string,
  ): Promise<{
    models: Array<{ name: string; size?: number }>
    diagnostic?: string
  }> {
    const url = `${this.base()}${path}`
    try {
      const res = await fetch(url, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const diag = `HTTP ${res.status} ${res.statusText} body=${body.slice(0, 200)}`
        console.warn(`[openai-compat] listModels ${url} ${diag}`)
        return { models: [], diagnostic: diag }
      }
      const raw = await res.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        const diag = `json parse error: ${(err as Error).message} preview=${raw.slice(0, 200)}`
        console.warn(`[openai-compat] listModels ${url} ${diag}`)
        return { models: [], diagnostic: diag }
      }

      const data = parsed as ModelListResponse
      const items = Array.isArray(data?.data) ? data.data : []
      if (items.length === 0) {
        const keys =
          parsed && typeof parsed === 'object'
            ? Object.keys(parsed as Record<string, unknown>).join(',')
            : typeof parsed
        const diag = `resposta sem 'data' array (keys=${keys}, preview=${raw.slice(0, 200)})`
        console.warn(`[openai-compat] listModels ${url} ${diag}`)
        return { models: [], diagnostic: diag }
      }
      const models = items
        .map((m) => ({ name: m.id }))
        .filter((m) => typeof m.name === 'string' && m.name.length > 0)
      console.info(
        `[openai-compat] listModels ${url} retornou ${models.length} modelo(s)`,
      )
      return { models }
    } catch (err) {
      const diag =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      console.warn(`[openai-compat] listModels ${url} threw ${diag}`)
      return { models: [], diagnostic: `fetch threw: ${diag}` }
    }
  }

  async ping(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const start = Date.now()
    try {
      // Pra OpenRouter, /v1/models é público (não valida API key). Usar
      // /v1/auth/key que exige auth e dá retorno real.
      const path = this.base().includes('openrouter.ai')
        ? '/v1/auth/key'
        : '/v1/models'

      const res = await fetch(`${this.base()}${path}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status} ${res.statusText}`
        const raw = await res.text().catch(() => '')
        try {
          const parsed = JSON.parse(raw) as {
            error?: { message?: string } | string
          }
          const msg =
            typeof parsed?.error === 'string'
              ? parsed.error
              : parsed?.error?.message
          if (msg) detail = `${res.status}: ${msg}`
        } catch {
          // raw não é JSON
        }
        return { ok: false, error: detail }
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
