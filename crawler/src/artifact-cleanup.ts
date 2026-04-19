import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { env } from './env.ts'

const DATA_DIR = env('DATA_DIR', '/data')

/**
 * Apaga o diretório inteiro do crawl (screenshots + DOM files).
 * Silencioso se não existir.
 */
export async function deleteCrawlArtifacts(
  projectId: string,
  crawlId: string,
): Promise<void> {
  const dir = join(DATA_DIR, 'projects', projectId, 'crawls', crawlId)
  try {
    await rm(dir, { recursive: true, force: true })
  } catch (err) {
    // Falha em apagar arquivo não é fatal — loga e segue
    console.error(
      `[crawler] cleanup: could not remove ${dir}:`,
      err instanceof Error ? err.message : err,
    )
  }
}
