import 'server-only'

import { readFile, readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, resolve } from 'node:path'

const DATA_DIR = process.env.DATA_DIR ?? '/data'

export interface CodeSignal {
  testIds: string[]
  formFields: string[]
  labels: string[]
  buttons: string[]
  apiRoutes: string[]
}

export type CodeInventory = Record<string, CodeSignal>

export interface StaticInspectOptions {
  projectId: string
  /** Lista de rotas que a feature cobre (ex.: ["/login", "/register"]). */
  paths: string[]
  /** Campo codeFocus da feature: aumenta prioridade ou ignora. */
  codeFocus?: Array<{ path: string; mode: 'focus' | 'ignore' }>
  /** Teto de bytes lidos agregados. 200KB por feature é suficiente. */
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 200 * 1024

// Extensões de arquivo que fazem sentido inspecionar. Templates, views,
// JSX/TSX/Vue/Svelte. Não abrimos CSS, imagens, locks, etc.
const INSPECTABLE_EXTENSIONS = new Set([
  '.tsx',
  '.jsx',
  '.ts',
  '.js',
  '.vue',
  '.svelte',
  '.astro',
  '.html',
])

// Nunca desce nessas pastas — já foram excluídas no snapshot do codex,
// mas defensivamente filtramos aqui também.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  '.turbo',
  'coverage',
  '.cache',
])

/**
 * Varre o snapshot do repo em /data/projects/<id>/source/ e extrai sinais
 * estáticos úteis pra o LLM gerar seletores de teste sem chutar. Best-effort:
 * falhas de I/O retornam inventário vazio (o prompt cai no fallback).
 */
export async function staticInspect(
  opts: StaticInspectOptions,
): Promise<CodeInventory> {
  const repoRoot = resolve(
    join(DATA_DIR, 'projects', opts.projectId, 'source'),
  )

  // Se o snapshot nem existe, retorna vazio — cenário comum de projetos
  // crawler-first OU quando o codex ainda não rodou a fase structure.
  try {
    const info = await stat(repoRoot)
    if (!info.isDirectory()) return {}
  } catch {
    return {}
  }

  const candidateFiles = await listFilesForPaths(repoRoot, opts.paths, opts.codeFocus)

  const inventory: CodeInventory = {}
  let bytesConsumed = 0
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  // Agrupa por path da feature
  for (const featurePath of opts.paths) {
    const signals: CodeSignal = {
      testIds: [],
      formFields: [],
      labels: [],
      buttons: [],
      apiRoutes: [],
    }
    const files = candidateFiles.get(featurePath) ?? []
    for (const file of files) {
      if (bytesConsumed >= maxBytes) break
      const absolute = join(repoRoot, file)
      const content = await readFile(absolute, 'utf8').catch(() => null)
      if (content === null) continue
      bytesConsumed += Buffer.byteLength(content, 'utf8')
      extractSignals(content, signals)
    }
    signals.testIds = dedupeClip(signals.testIds, 40)
    signals.formFields = dedupeClip(signals.formFields, 30)
    signals.labels = dedupeClip(signals.labels, 40)
    signals.buttons = dedupeClip(signals.buttons, 40)
    signals.apiRoutes = dedupeClip(signals.apiRoutes, 20)

    if (
      signals.testIds.length +
        signals.formFields.length +
        signals.labels.length +
        signals.buttons.length >
      0
    ) {
      inventory[featurePath] = signals
    }
  }

  return inventory
}

function dedupeClip(arr: string[], limit: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of arr) {
    const trimmed = v.trim()
    if (trimmed.length === 0) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Mapeia paths da feature (ex.: "/login") para arquivos candidatos no
 * snapshot. Heurística simples e agnóstica de framework:
 *   1. procura por nomes que casam com o último segmento do path
 *   2. prioriza `page.tsx`, `route.tsx`, `index.tsx`, `+page.svelte`
 *   3. se tem codeFocus=focus, adiciona esses paths também
 *   4. se tem codeFocus=ignore, remove arquivos que batem
 */
async function listFilesForPaths(
  repoRoot: string,
  paths: string[],
  codeFocus?: Array<{ path: string; mode: 'focus' | 'ignore' }>,
): Promise<Map<string, string[]>> {
  const allFiles: string[] = []
  await walkDir(repoRoot, '', allFiles)

  const focusPrefixes =
    codeFocus
      ?.filter((f) => f.mode === 'focus')
      .map((f) => f.path.replace(/^\//, '').replace(/\\/g, '/')) ?? []
  const ignorePrefixes =
    codeFocus
      ?.filter((f) => f.mode === 'ignore')
      .map((f) => f.path.replace(/^\//, '').replace(/\\/g, '/')) ?? []

  const result = new Map<string, string[]>()

  for (const featurePath of paths) {
    const segments = featurePath.split('/').filter(Boolean)
    const lastSeg = segments[segments.length - 1] ?? ''

    const matches: Array<{ file: string; score: number }> = []

    for (const file of allFiles) {
      // Ignore areas marcadas pela QA
      if (ignorePrefixes.some((p) => file.startsWith(p))) continue

      let score = 0

      // Match pelo nome do arquivo ou pasta (último segmento do path)
      if (lastSeg && file.toLowerCase().includes(`/${lastSeg.toLowerCase()}`)) {
        score += 10
      }
      if (lastSeg && file.toLowerCase().includes(`${lastSeg.toLowerCase()}.`)) {
        score += 5
      }

      // Match pelo padrão do framework
      const base = file.split('/').pop() ?? ''
      if (/^(page|route|index)\.(tsx?|jsx?)$/.test(base)) score += 3
      if (base === '+page.svelte' || base === '+page.ts') score += 3

      // Boost em focus
      if (focusPrefixes.some((p) => file.startsWith(p))) score += 20

      if (score > 0) {
        matches.push({ file, score })
      }
    }

    matches.sort((a, b) => b.score - a.score)
    result.set(
      featurePath,
      matches.slice(0, 8).map((m) => m.file),
    )
  }

  return result
}

async function walkDir(
  root: string,
  rel: string,
  out: string[],
): Promise<void> {
  const here = rel ? join(root, rel) : root
  let entries: Dirent[]
  try {
    entries = await readdir(here, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue
    const sub = rel ? `${rel}/${ent.name}` : ent.name
    if (ent.isDirectory()) {
      await walkDir(root, sub, out)
    } else if (ent.isFile()) {
      const dotIdx = ent.name.lastIndexOf('.')
      const ext = dotIdx >= 0 ? ent.name.slice(dotIdx).toLowerCase() : ''
      if (INSPECTABLE_EXTENSIONS.has(ext)) {
        out.push(sub)
      }
    }
  }
}

// ---------------------------------------------------------------
// Extração de sinais via regex. Intencionalmente leve e permissiva:
// preferimos falsos-positivos (inventário com lixo) a falsos-negativos
// (LLM sem ancora). O prompt instrui o LLM a escolher o mais provável.
// ---------------------------------------------------------------

const PATTERNS = {
  // data-testid="foo" ou data-testid={`foo-${n}`}
  testId: /data-testid=["'`]([^"'`<>\n]{1,80})["'`]/g,
  // <input name="email"> ou <Input name="email">
  formField: /<(?:input|textarea|select|Input|Textarea|Select|Field)\b[^>]*\bname=["']([^"']{1,80})["']/gi,
  // <label for="email">Email</label> ou JSX <Label htmlFor="email">
  label: /<(?:label|Label)\b[^>]*(?:for|htmlFor)=["']([^"']{1,80})["']/gi,
  // <button>Entrar</button> ou <Button>Entrar</Button>
  buttonText: /<(?:button|Button)(?:\s+[^>]*)?>\s*([^<{]{1,80}?)\s*<\/(?:button|Button)>/gi,
  // fetch('/api/...'), useFetch('/api/...'), axios.get('/api/...')
  apiRoute: /(?:fetch|axios\.[a-z]+|useFetch|\$fetch)\(["'`](\/[^"'`\s]{1,120})["'`]/g,
}

function extractSignals(content: string, out: CodeSignal): void {
  let m: RegExpExecArray | null

  while ((m = PATTERNS.testId.exec(content)) !== null) out.testIds.push(m[1])
  PATTERNS.testId.lastIndex = 0

  while ((m = PATTERNS.formField.exec(content)) !== null)
    out.formFields.push(m[1])
  PATTERNS.formField.lastIndex = 0

  while ((m = PATTERNS.label.exec(content)) !== null) out.labels.push(m[1])
  PATTERNS.label.lastIndex = 0

  while ((m = PATTERNS.buttonText.exec(content)) !== null)
    out.buttons.push(m[1].replace(/\s+/g, ' '))
  PATTERNS.buttonText.lastIndex = 0

  while ((m = PATTERNS.apiRoute.exec(content)) !== null)
    out.apiRoutes.push(m[1])
  PATTERNS.apiRoute.lastIndex = 0
}

