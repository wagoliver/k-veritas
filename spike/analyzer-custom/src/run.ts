import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { argv, env, exit, stderr, stdout } from 'node:process'

import Anthropic from '@anthropic-ai/sdk'

import { AnalysisSchema } from './schema.ts'
import { CODE_ANALYSIS_SYSTEM_PROMPT, buildUserMessage } from './prompt.ts'
import { Sandbox, TOOL_DEFINITIONS, dispatchTool } from './tools.ts'

interface RunMetrics {
  approach: 'custom'
  model: string
  runId: string
  repoRoot: string
  startedAt: string
  finishedAt: string
  durationMs: number
  toolCalls: number
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  stopReason: string | null
  schemaValid: boolean
  schemaError?: string
  rawFinalText: string
  analysis: unknown
}

const MODEL = env.ANALYZER_MODEL ?? 'claude-sonnet-4-5-20250929'
const MAX_TOOL_ITERATIONS = Number(env.ANALYZER_MAX_ITERATIONS ?? 40)
const MAX_OUTPUT_TOKENS = Number(env.ANALYZER_MAX_TOKENS ?? 8192)

async function main(): Promise<void> {
  const repoArg = argv[2]
  if (!repoArg) {
    stderr.write(
      'uso: node --experimental-strip-types src/run.ts <path-do-repo-descompactado>\n',
    )
    exit(2)
  }
  if (!env.ANTHROPIC_API_KEY) {
    stderr.write('ANTHROPIC_API_KEY não definida no ambiente\n')
    exit(2)
  }

  const repoRoot = resolve(repoArg)
  const sandbox = new Sandbox(repoRoot)
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  stderr.write(`[analyzer-custom] model=${MODEL} repo=${repoRoot}\n`)

  // Histórico de mensagens no formato da Anthropic.
  type Msg = Anthropic.MessageParam
  const messages: Msg[] = [
    { role: 'user', content: buildUserMessage(repoRoot) },
  ]

  let tokensIn = 0
  let tokensOut = 0
  let cacheReadTokens = 0
  let toolCalls = 0
  let finalText = ''
  let stopReason: string | null = null

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: CODE_ANALYSIS_SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages,
    })

    tokensIn += resp.usage.input_tokens ?? 0
    tokensOut += resp.usage.output_tokens ?? 0
    cacheReadTokens += resp.usage.cache_read_input_tokens ?? 0
    stopReason = resp.stop_reason ?? null

    // Agrega texto e tool_use blocks. Preserva o assistant message no histórico.
    messages.push({ role: 'assistant', content: resp.content })

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )

    if (resp.stop_reason === 'end_turn' || toolUses.length === 0) {
      finalText = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      break
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      toolCalls++
      const out = await dispatchTool(
        sandbox,
        tu.name,
        (tu.input ?? {}) as Record<string, unknown>,
      )
      stderr.write(
        `[analyzer-custom] tool=${tu.name} input=${JSON.stringify(tu.input).slice(0, 120)} bytes=${out.length}\n`,
      )
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: out,
      })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  const durationMs = Date.now() - t0
  const finishedAt = new Date().toISOString()

  // Tenta extrair JSON. Primeiro tenta o texto inteiro; se falhar, procura
  // o maior bloco entre { e } balanceado.
  let parsed: unknown = null
  let schemaValid = false
  let schemaError: string | undefined
  try {
    parsed = JSON.parse(finalText)
  } catch {
    const maybe = extractJsonObject(finalText)
    if (maybe) {
      try {
        parsed = JSON.parse(maybe)
      } catch (e) {
        schemaError = `JSON parse falhou: ${(e as Error).message}`
      }
    } else {
      schemaError = 'nenhum objeto JSON encontrado na resposta final'
    }
  }

  if (parsed != null && !schemaError) {
    const result = AnalysisSchema.safeParse(parsed)
    if (result.success) {
      schemaValid = true
      parsed = result.data
    } else {
      schemaError = `zod: ${result.error.message}`
    }
  }

  const metrics: RunMetrics = {
    approach: 'custom',
    model: MODEL,
    runId,
    repoRoot,
    startedAt,
    finishedAt,
    durationMs,
    toolCalls,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    stopReason,
    schemaValid,
    schemaError,
    rawFinalText: finalText,
    analysis: parsed,
  }

  // Escreve resultado em spike/results/ (relativo a cwd).
  const resultsDir = resolve(env.RESULTS_DIR ?? 'results')
  await mkdir(resultsDir, { recursive: true })
  const outPath = join(resultsDir, `run-${runId}-custom.json`)
  await writeFile(outPath, JSON.stringify(metrics, null, 2), 'utf8')

  stderr.write(
    `[analyzer-custom] done tools=${toolCalls} in=${tokensIn} out=${tokensOut} ms=${durationMs} valid=${schemaValid} -> ${outPath}\n`,
  )

  // Stdout recebe apenas o JSON da análise (ou vazio se inválido).
  if (schemaValid) {
    stdout.write(JSON.stringify(parsed) + '\n')
  } else {
    stderr.write(`[analyzer-custom] schema INVÁLIDO: ${schemaError}\n`)
    exit(1)
  }
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

main().catch((err) => {
  stderr.write(`[analyzer-custom] FATAL: ${(err as Error).stack ?? err}\n`)
  exit(1)
})
