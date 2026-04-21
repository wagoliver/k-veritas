import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { env } from './env.ts'

const DATA_DIR = env('DATA_DIR', '/data')

/**
 * Apaga pastas de run mais antigas que o TTL configurado.
 * Trace+screenshot por teste geram ~5–15MB por run, então retenção automática
 * evita o volume artifacts crescer sem limite.
 *
 * Estrutura: /data/projects/<projectId>/exec/<runId>/
 */
export async function sweepOldExecArtifacts(
  ttlDays: number,
): Promise<{ scanned: number; deleted: number }> {
  const projectsRoot = join(DATA_DIR, 'projects')
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000
  let scanned = 0
  let deleted = 0

  let projectDirs: string[]
  try {
    projectDirs = await readdir(projectsRoot)
  } catch {
    return { scanned: 0, deleted: 0 }
  }

  for (const projectId of projectDirs) {
    const execRoot = join(projectsRoot, projectId, 'exec')
    let runDirs: string[]
    try {
      runDirs = await readdir(execRoot)
    } catch {
      continue
    }

    for (const runId of runDirs) {
      scanned++
      const runPath = join(execRoot, runId)
      try {
        const info = await stat(runPath)
        if (info.mtimeMs < cutoff) {
          await rm(runPath, { recursive: true, force: true })
          deleted++
        }
      } catch (err) {
        console.error(
          `[runner] cleanup: could not process ${runPath}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  return { scanned, deleted }
}
