import { spawn } from 'node:child_process'

import type { PromptInput } from './prompt.ts'
import { buildSystemPrompt, buildUserPrompt } from './prompt.ts'

export interface RunClaudeOptions {
  input: PromptInput
  repoRoot: string
  outputDir: string
  credential: string
  authMode: 'api_key' | 'oauth'
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
  // Flags/detalhes capturados do evento "result" do stream-json.
  // Claude Code 2.x reporta falhas como `is_error: true` + `subtype`
  // (ex: "error_max_turns", "error_during_execution") + `result`
  // com a mensagem humana. O exit code fica 1 mesmo quando a causa
  // é semântica (não crash).
  isError: boolean
  errorSubtype: string | null
  errorMessage: string | null
  // Linhas coletadas de eventos type="system"/"error" do próprio CLI.
  systemNotices: string[]
  // Últimos 4KB do stdout bruto pra debug quando nada mais ajuda.
  rawStdoutTail: string
}

/**
 * Invoca `claude -p` em modo headless.
 *
 * Flags sempre presentes:
 *   --append-system-prompt <str>   → injeta k-veritas master + CLAUDE.md do repo
 *   --add-dir <outputDir>          → permite escrever specs fora do cwd
 *   --permission-mode bypass...    → não prompta permissões
 *   --max-budget-usd <n>           → teto de gasto (só relevante em API key)
 *   --output-format stream-json    → stream parseável de tool-use
 *
 * Dependente do authMode:
 *   api_key → adiciona --bare (força ANTHROPIC_API_KEY, skip keychain)
 *             env ANTHROPIC_API_KEY = token
 *
 *   oauth   → SEM --bare (permite OAuth via env var)
 *             env CLAUDE_CODE_OAUTH_TOKEN = token (gerado por `claude setup-token`)
 *             auto-discovery de CLAUDE.md volta a funcionar, então manter
 *             o --append-system-prompt é redundante mas inofensivo.
 */
export async function runClaude(
  opts: RunClaudeOptions,
): Promise<RunClaudeResult> {
  const systemPrompt = await buildSystemPrompt(opts.repoRoot)
  const userPrompt = buildUserPrompt(opts.input)

  const args: string[] = [
    '-p',
    userPrompt,
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

  if (opts.authMode === 'api_key') {
    // --bare força o CLI a ler estritamente ANTHROPIC_API_KEY, sem
    // tentar keychain/OAuth/hooks. Modo isolado puro.
    args.push('--bare')
  }

  const envExtra: NodeJS.ProcessEnv = { DISABLE_TELEMETRY: '1' }
  if (opts.authMode === 'oauth') {
    envExtra.CLAUDE_CODE_OAUTH_TOKEN = opts.credential
    // HOME é necessário pro CLI achar config dir em modo OAuth. Se não
    // estiver setado no container, usa /tmp. Dentro do codex (user
    // "node"), /home/node já existe.
    envExtra.HOME = process.env.HOME || '/home/node'
  } else {
    envExtra.ANTHROPIC_API_KEY = opts.credential
  }

  const proc = spawn('claude', args, {
    cwd: opts.repoRoot,
    env: { ...process.env, ...envExtra },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let tokensIn = 0
  let tokensOut = 0
  let turnsUsed = 0
  let finalMessage: string | null = null
  let stderr = ''
  let stdoutBuffer = ''
  let rawStdoutAccum = ''
  let isError = false
  let errorSubtype: string | null = null
  let errorMessage: string | null = null
  const systemNotices: string[] = []

  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })

  proc.stdout.on('data', async (chunk) => {
    const text = chunk.toString('utf8')
    rawStdoutAccum += text
    stdoutBuffer += text
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
        if (parsed.is_error === true) {
          isError = true
          if (typeof parsed.subtype === 'string') {
            errorSubtype = parsed.subtype
          }
          if (typeof parsed.result === 'string') {
            errorMessage = parsed.result
          } else if (typeof parsed.error === 'string') {
            errorMessage = parsed.error
          }
        }
      }

      // Eventos de sistema/erro do próprio CLI (stream-json emite alguns
      // como type="system" ou "error") — guardamos os textos pra repasse.
      if (type === 'system' || type === 'error') {
        const text =
          typeof parsed.text === 'string'
            ? parsed.text
            : typeof parsed.message === 'string'
              ? (parsed.message as string)
              : typeof parsed.error === 'string'
                ? (parsed.error as string)
                : JSON.stringify(parsed).slice(0, 300)
        systemNotices.push(`[${type}] ${text}`)
        if (type === 'error' && !errorMessage) {
          errorMessage = text
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
    isError,
    errorSubtype,
    errorMessage,
    systemNotices,
    rawStdoutTail: rawStdoutAccum.slice(-4000),
  }
}
