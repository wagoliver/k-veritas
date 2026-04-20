import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

// Sandbox: todas as tools operam APENAS dentro da raiz do repo recebida.
// Qualquer path que resolva fora da raiz é rejeitado.

const MAX_FILE_BYTES = 64 * 1024
const MAX_DIR_ENTRIES = 200
const MAX_GREP_MATCHES = 80
const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  '.turbo',
  'coverage',
  '.vercel',
])

export class Sandbox {
  readonly root: string

  constructor(rootAbs: string) {
    this.root = resolve(rootAbs)
  }

  private resolveInside(relPath: string): string {
    const clean = relPath.replace(/^[/\\]+/, '')
    const abs = resolve(this.root, clean)
    const normRoot = this.root.endsWith(sep) ? this.root : this.root + sep
    if (abs !== this.root && !abs.startsWith(normRoot)) {
      throw new Error(`path escapa a raiz: ${relPath}`)
    }
    return abs
  }

  async listDir(path: string): Promise<string> {
    const abs = this.resolveInside(path || '.')
    const st = await stat(abs)
    if (!st.isDirectory()) return `NOT_A_DIR: ${path}`
    const entries = await readdir(abs, { withFileTypes: true })
    const lines: string[] = []
    let count = 0
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (IGNORED_DIRS.has(entry.name)) continue
      if (count++ >= MAX_DIR_ENTRIES) {
        lines.push(`... (truncado em ${MAX_DIR_ENTRIES} entradas)`)
        break
      }
      lines.push(entry.isDirectory() ? `${entry.name}/` : entry.name)
    }
    const rel = relative(this.root, abs) || '.'
    return `dir: ${rel}\n${lines.join('\n') || '(vazio)'}`
  }

  async readFile(path: string): Promise<string> {
    const abs = this.resolveInside(path)
    const st = await stat(abs)
    if (!st.isFile()) return `NOT_A_FILE: ${path}`
    const buf = await readFile(abs)
    const truncated = buf.byteLength > MAX_FILE_BYTES
    const content = buf
      .subarray(0, MAX_FILE_BYTES)
      .toString('utf8')
    const rel = relative(this.root, abs)
    const suffix = truncated
      ? `\n... (truncado em ${MAX_FILE_BYTES} bytes de ${st.size} totais)`
      : ''
    return `file: ${rel} (${st.size}b)\n---\n${content}${suffix}`
  }

  grep(pattern: string, glob?: string): string {
    // Tenta ripgrep, cai pra fallback simples se não estiver disponível.
    const rg = spawnSync(
      'rg',
      [
        '--no-heading',
        '--line-number',
        '--color=never',
        '--max-count',
        String(MAX_GREP_MATCHES),
        ...(glob ? ['--glob', glob] : []),
        ...Array.from(IGNORED_DIRS).flatMap((d) => ['--glob', `!${d}/**`]),
        pattern,
      ],
      { cwd: this.root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
    )
    if (rg.status === null && rg.error) {
      return `ERROR: ripgrep não disponível no ambiente (${rg.error.message})`
    }
    const stdout = rg.stdout ?? ''
    const lines = stdout.split('\n').filter(Boolean)
    if (lines.length === 0) return 'no matches'
    const clipped = lines.slice(0, MAX_GREP_MATCHES).join('\n')
    const suffix =
      lines.length > MAX_GREP_MATCHES
        ? `\n... (${lines.length - MAX_GREP_MATCHES} matches adicionais)`
        : ''
    return clipped + suffix
  }
}

// Definições expostas ao modelo via Anthropic tool-use.

export const TOOL_DEFINITIONS = [
  {
    name: 'list_dir',
    description:
      'Lista arquivos e subdiretórios de um caminho relativo à raiz do repositório. Passe "." para a raiz. Diretórios comuns de build/deps (node_modules, .next, .git, dist) são ocultos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Caminho relativo. Ex.: ".", "app", "app/api".' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description:
      'Lê o conteúdo de um arquivo. Caminho relativo à raiz. Truncado em 64KB.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Caminho relativo. Ex.: "app/middleware.ts".' },
      },
      required: ['path'],
    },
  },
  {
    name: 'grep',
    description:
      'Busca regex no código-fonte usando ripgrep. Opcionalmente filtre por glob (ex.: "**/*.ts").',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Expressão regular.' },
        glob: { type: 'string', description: 'Glob opcional.' },
      },
      required: ['pattern'],
    },
  },
]

export async function dispatchTool(
  sandbox: Sandbox,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'list_dir':
        return await sandbox.listDir(String(input.path ?? '.'))
      case 'read_file':
        return await sandbox.readFile(String(input.path ?? ''))
      case 'grep':
        return sandbox.grep(
          String(input.pattern ?? ''),
          input.glob ? String(input.glob) : undefined,
        )
      default:
        return `UNKNOWN_TOOL: ${name}`
    }
  } catch (err) {
    return `ERROR: ${(err as Error).message}`
  }
}
