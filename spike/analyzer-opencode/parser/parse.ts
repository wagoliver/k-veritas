import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { argv, exit, stderr, stdout } from 'node:process'

import { AnalysisSchema } from './schema.ts'

interface Args {
  raw: string
  stderrFile: string
  runId: string
  model: string
  startedAt: string
  finishedAt: string
  durationMs: number
  exitCode: number
  resultsDir: string
}

function parseArgs(): Args {
  const a: Record<string, string> = {}
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    a[key] = argv[i + 1]
  }
  return {
    raw: a.raw,
    stderrFile: a.stderr,
    runId: a.runId,
    model: a.model,
    startedAt: a.startedAt,
    finishedAt: a.finishedAt,
    durationMs: Number(a.durationMs),
    exitCode: Number(a.exitCode),
    resultsDir: a.resultsDir,
  }
}

// Extrai o maior objeto JSON balanceado em um texto — tolera preâmbulo,
// markdown fences e epílogo conversacional (que é o caso típico de CLIs
// agênticos não instruídos a responder só-JSON).
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  let best: string | null = null
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const candidate = text.slice(start, i + 1)
        // Mantém o maior candidato válido.
        if (!best || candidate.length > best.length) best = candidate
      }
    }
  }
  return best
}

function stripFences(text: string): string {
  // Remove ```json ... ``` ou ``` ... ```
  return text.replace(/```(?:json)?\s*([\s\S]*?)```/g, (_m, inner) => inner)
}

async function main(): Promise<void> {
  const args = parseArgs()
  const rawText = await readFile(args.raw, 'utf8')
  const stderrText = await readFile(args.stderrFile, 'utf8').catch(() => '')

  const cleaned = stripFences(rawText)
  const candidate = extractJsonObject(cleaned)

  let parsed: unknown = null
  let schemaValid = false
  let schemaError: string | undefined

  if (!candidate) {
    schemaError = 'nenhum objeto JSON encontrado na saída do opencode'
  } else {
    try {
      parsed = JSON.parse(candidate)
    } catch (e) {
      schemaError = `JSON parse falhou: ${(e as Error).message}`
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

  const metrics = {
    approach: 'opencode' as const,
    model: args.model,
    runId: args.runId,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    durationMs: args.durationMs,
    exitCode: args.exitCode,
    schemaValid,
    schemaError,
    rawOutputBytes: rawText.length,
    rawStderrBytes: stderrText.length,
    rawFinalText: rawText,
    rawStderr: stderrText,
    analysis: parsed,
    // OpenCode não expõe contagem de tokens de forma padronizada no CLI;
    // fica como TODO do spike: extrair via log-level verbose se disponível.
    tokensIn: null,
    tokensOut: null,
  }

  await mkdir(resolve(args.resultsDir), { recursive: true })
  const outPath = join(resolve(args.resultsDir), `run-${args.runId}-opencode.json`)
  await writeFile(outPath, JSON.stringify(metrics, null, 2), 'utf8')

  stderr.write(
    `[analyzer-opencode/parser] valid=${schemaValid} bytes=${rawText.length} -> ${outPath}\n`,
  )

  if (schemaValid) {
    stdout.write(JSON.stringify(parsed) + '\n')
  } else {
    stderr.write(`[analyzer-opencode/parser] schema INVÁLIDO: ${schemaError}\n`)
    exit(1)
  }
}

main().catch((err) => {
  stderr.write(`[analyzer-opencode/parser] FATAL: ${(err as Error).stack ?? err}\n`)
  exit(1)
})
