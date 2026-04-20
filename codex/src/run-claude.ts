import { spawn } from 'node:child_process'

import type { PromptInput } from './prompt.ts'
import { buildPrompt } from './prompt.ts'

export interface RunClaudeOptions {
  input: PromptInput
  repoRoot: string
  apiKey: string
  model: string
  maxTurns: number
  // Chamado em cada evento do stream (pra alimentar heartbeat + UI).
  onEvent?: (evt: ClaudeStreamEvent) => void | Promise<void>
}

export interface ClaudeStreamEvent {
  type: string
  // Estrutura dos eventos do stream-json do Claude Code evoluiu entre
  // versões. Guardamos o JSON bruto e só inspecionamos campos
  // conhecidos de forma defensiva.
  raw: unknown
  // Extraídos quando presentes.
  turnNumber?: number
  toolName?: string
  textChunk?: string
}

export interface RunClaudeResult {
  exitCode: number
  tokensIn: number
  tokensOut: number
  turnsUsed: number
  finalMessage: string | null
  stderr: string
}

// Invoca `claude -p <prompt>` em modo headless com saída stream-json.
// Cada linha é um objeto JSON; parseamos e emitimos via onEvent.
export async function runClaude(
  opts: RunClaudeOptions,
): Promise<RunClaudeResult> {
  const prompt = buildPrompt(opts.input)

  const args = [
    '-p',
    prompt,
    '--bare',
    '--permission-mode',
    'dontAsk',
    '--max-turns',
    String(opts.maxTurns),
    '--output-format',
    'stream-json',
    '--model',
    opts.model,
  ]

  const proc = spawn('claude', args, {
    cwd: opts.repoRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: opts.apiKey,
      // Desativa captura de telemetria do CLI dentro do container.
      DISABLE_TELEMETRY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let tokensIn = 0
  let tokensOut = 0
  let turnsUsed = 0
  let finalMessage: string | null = null
  let stderr = ''
  let stdoutBuffer = ''

  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })

  proc.stdout.on('data', async (chunk) => {
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }

      const type = String(parsed.type ?? 'unknown')
      const evt: ClaudeStreamEvent = { type, raw: parsed }

      // Extração defensiva de campos conhecidos. O schema do
      // stream-json do Claude Code tem variantes (system, assistant,
      // user, tool_use, result). Usamos o que estiver disponível.
      if (typeof parsed.turn === 'number') evt.turnNumber = parsed.turn
      if (typeof parsed.tool_name === 'string') evt.toolName = parsed.tool_name

      const message = parsed.message as
        | { content?: Array<{ type: string; text?: string; name?: string }> }
        | undefined
      if (message?.content) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            evt.textChunk = block.text
            if (type === 'assistant') {
              // Mantemos a última mensagem do assistant como "final".
              finalMessage = block.text
            }
          } else if (block.type === 'tool_use' && block.name) {
            evt.toolName = block.name
          }
        }
      }

      // Resultado final tem contadores agregados.
      if (type === 'result') {
        const usage = parsed.usage as
          | { input_tokens?: number; output_tokens?: number }
          | undefined
        if (usage) {
          tokensIn += usage.input_tokens ?? 0
          tokensOut += usage.output_tokens ?? 0
        }
        if (typeof parsed.num_turns === 'number') {
          turnsUsed = parsed.num_turns
        }
        if (typeof parsed.result === 'string') {
          finalMessage = parsed.result
        }
      }

      // Usage por mensagem (stream incremental).
      const usageInline = parsed.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined
      if (usageInline && type !== 'result') {
        tokensIn += usageInline.input_tokens ?? 0
        tokensOut += usageInline.output_tokens ?? 0
      }

      if (evt.turnNumber && evt.turnNumber > turnsUsed) {
        turnsUsed = evt.turnNumber
      }

      if (opts.onEvent) await opts.onEvent(evt)
    }
  })

  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.on('error', reject)
    proc.on('exit', (code) => resolve(code ?? 1))
  })

  return {
    exitCode,
    tokensIn,
    tokensOut,
    turnsUsed,
    finalMessage,
    stderr: stderr.slice(-4000),
  }
}
