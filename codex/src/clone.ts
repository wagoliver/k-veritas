import { spawn } from 'node:child_process'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import AdmZip from 'adm-zip'

import { env } from './env.ts'
import type { CodeAnalysisPhase, Project } from './db.ts'

const DATA_DIR = env('DATA_DIR', '/data')
const WORK_DIR = env('WORK_DIR', '/work')

export interface CloneResult {
  repoRoot: string // /work/<jobId>/repo
  jobRoot: string // /work/<jobId>
  outputDir: string // /work/<jobId>/output
}

export async function prepareJobWorkspace(
  jobId: string,
  project: Project,
  phase: CodeAnalysisPhase = 'structure',
): Promise<CloneResult> {
  const jobRoot = join(WORK_DIR, jobId)
  const repoRoot = join(jobRoot, 'repo')
  const outputDir = join(jobRoot, 'output')

  await mkdir(repoRoot, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  // Só reserva a pasta de specs quando for de fato gerar testes.
  if (phase === 'tests') {
    await mkdir(join(outputDir, 'tests'), { recursive: true })
  }

  // Contexto de negócio pra Claude Code só faz sentido na fase 'tests',
  // que roda escopada a uma feature com contexto preenchido pela QA.
  // A fase 'structure' só faz inventário — nunca lê context.md.
  if (phase === 'tests') {
    const contextBody =
      (project.business_context ?? '').trim().length > 0
        ? project.business_context!
        : '> (sem contexto de negócio fornecido pela QA — trabalhe apenas com o código)'
    await writeFile(join(jobRoot, 'context.md'), contextBody, 'utf8')
  }

  if (project.source_type === 'repo' && project.repo_url) {
    await gitClone(project.repo_url, project.repo_branch ?? 'main', repoRoot)
  } else if (project.repo_zip_path) {
    await unzipFromData(project.repo_zip_path, repoRoot)
  } else {
    throw new Error(
      'projeto sem fonte resolvida (repo_url ou repo_zip_path obrigatório para analysis_type=code)',
    )
  }

  return { repoRoot, jobRoot, outputDir }
}

function gitClone(url: string, branch: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'git',
      ['clone', '--depth', '1', '--branch', branch, url, dest],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`git clone falhou (code=${code}): ${stderr.slice(-500)}`))
    })
  })
}

async function unzipFromData(
  relativePath: string,
  dest: string,
): Promise<void> {
  // repoZipPath é relativo ao volume /data (ex.: projects/<id>/source.zip).
  const abs = join(DATA_DIR, relativePath)
  const zip = new AdmZip(abs)
  zip.extractAllTo(dest, /*overwrite*/ true)
}

// Pastas e arquivos que nunca vão para o snapshot persistido em /data —
// inúteis pro static-inspect do app e só inflam o disco.
const SNAPSHOT_EXCLUDE = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  '.turbo',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.cache',
])

/**
 * Persiste uma cópia enxuta do repoRoot em /data/projects/<projectId>/source/
 * pra que o serviço `app` (volume /data compartilhado) consiga ler o código
 * quando for gerar testes. O volume /work do codex não é acessível fora
 * do codex, então precisamos duplicar — aceitável dado que é shallow
 * clone (só último commit).
 *
 * Reescreve se já existir. Exclui pastas pesadas/inúteis.
 */
export async function persistRepoSnapshot(
  projectId: string,
  repoRoot: string,
): Promise<string> {
  const dest = join(DATA_DIR, 'projects', projectId, 'source')
  await rm(dest, { recursive: true, force: true }).catch(() => {})
  await mkdir(dest, { recursive: true })
  await cp(repoRoot, dest, {
    recursive: true,
    filter: (src) => {
      const name = basename(src)
      return !SNAPSHOT_EXCLUDE.has(name)
    },
  })
  return dest
}
