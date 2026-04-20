import { spawn } from 'node:child_process'

import type { PromptInput } from './prompt.ts'
import { buildSystemPrompt, buildUserPrompt } from './prompt.ts'

export interface RunClaudeOptions {
  input: PromptInput
  repoRoot: string
  outputDir: string
  apiKey: string
  model: string
  maxBudgetUsd: number
  onEvent?: (evt: ClaudeStreamEvent) => void | Promise<void>
}

export interface ClaudeStreamEvent {
  type: string
  raw: unknown
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

/**
 * Invoca `claude -p` em modo headless com:
 *
 *   --bare                         → força ANTHROPIC_API_KEY, skip keychain/hooks
 *   --append-system-prompt <str>   → injeta k-veritas master + CLAUDE.md do repo
 *   --add-dir <outputDir>          → permite Claude escrever specs fora do cwd
 *   --permission-mode bypass...    → não prompta permissões (container trusted)
 *   --max-budget-usd <n>           → teto real de gasto por rodada
 *   --output-format stream-json    → stream parseável com events de tool-use
 *
 * A auto-descoberta de CLAUDE.md é desativada pelo --bare; por isso a
 * leitura é explícita em buildSystemPrompt() e injetada via append.
 */
export async function runClaude(
  opts: RunClaudeOptions,
): Promise<RunClaudeResult> {
  const systemPrompt = await buildSystemPrompt(opts.repoRoot)
  const userPrompt = buildUserPrompt(opts.input)

  const args = [
    '-p',
    userPrompt,
    '--bare',
    '--append-system-prompt',
    systemPrompt,
    '--add-dir',
    opts.outputDir,
    '--permission-mode',
    'bypassPermissions',
    '--max-budget-usd',
    String(opts.maxBudgetUsd),
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    opts.model,
  ]

  const proc = spawn('claude', args, {
    cwd: opts.repoRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: opts.apiKey,
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
              finalMessage = block.text
            }
          } else if (block.type === 'tool_use' && block.name) {
            evt.toolName = block.name
          }
        }
      }

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
