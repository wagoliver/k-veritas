import {
  claimNextJob,
  deleteCrawl,
  fetchCrawlForHistory,
  findOldCompletedCrawls,
  markCompleted,
  markFailed,
  requeueStaleJobs,
  savePage,
  heartbeat,
  type Project,
} from './db.ts'
import { collectDom } from './dom-collector.ts'
import { recordCrawlHistory } from './clickhouse.ts'
import { deleteCrawlArtifacts } from './artifact-cleanup.ts'

const WORKER_ID = `crawler-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
const POLL_INTERVAL_MS = Number(process.env.CRAWLER_POLL_MS ?? 2000)
const STALE_TIMEOUT_SECONDS = Number(process.env.CRAWLER_STALE_SECONDS ?? 600)

let stopping = false
process.on('SIGTERM', () => {
  stopping = true
})
process.on('SIGINT', () => {
  stopping = true
})

export async function runWorkerLoop(): Promise<void> {
  console.log(`[crawler] ${WORKER_ID} starting`)
  let lastReQueueAt = 0

  while (!stopping) {
    try {
      const now = Date.now()
      if (now - lastReQueueAt > 60_000) {
        const requeued = await requeueStaleJobs(STALE_TIMEOUT_SECONDS)
        if (requeued > 0) {
          console.log(`[crawler] requeued ${requeued} stale job(s)`)
        }
        lastReQueueAt = now
      }

      const next = await claimNextJob(WORKER_ID)
      if (!next) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      const { job, project } = next
      console.log(
        `[crawler] job ${job.id} for project ${project.slug} (${project.target_url})`,
      )

      const heartbeatTimer = setInterval(
        () => heartbeat(job.id, WORKER_ID).catch(() => {}),
        15_000,
      )

      const startedAtMs = Date.now()
      try {
        const { pagesCount } = await collectDom(project, job.id, {
          onPage: async (page) => {
            await savePage(job.id, page)
          },
          onProgress: async (info) => {
            console.log(
              `[crawler] ${job.id} page ${info.index}/${info.total}: ${info.url}`,
            )
          },
        })
        await markCompleted(job.id, project.id, pagesCount)
        console.log(`[crawler] job ${job.id} completed (${pagesCount} pages)`)

        // Pós-conclusão: histórico no CH + GC de crawls antigos.
        // Erros aqui não invalidam o crawl recém-concluído.
        await finalizeHistory(project, job.id, startedAtMs).catch((err) => {
          console.error(
            `[crawler] job ${job.id} history/cleanup failed:`,
            err instanceof Error ? err.message : err,
          )
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[crawler] job ${job.id} failed:`, msg)
        await markFailed(job.id, project.id, msg)
      } finally {
        clearInterval(heartbeatTimer)
      }
    } catch (err) {
      console.error('[crawler] loop error:', err)
      await sleep(POLL_INTERVAL_MS)
    }
  }

  console.log('[crawler] stopping')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Após um crawl concluir com sucesso:
 *   1. Grava resumo + snapshot por página no ClickHouse (histórico)
 *   2. Só depois de confirmar que o CH gravou, apaga os crawls completed
 *      anteriores do Postgres e seus arquivos do volume.
 *
 * Se o CH falhar, nada é apagado — os crawls antigos ficam onde estão
 * e uma próxima tentativa limpa (comportamento conservador).
 */
async function finalizeHistory(
  project: Project,
  crawlId: string,
  startedAtMs: number,
): Promise<void> {
  const snapshot = await fetchCrawlForHistory(crawlId)

  await recordCrawlHistory(
    {
      project_id: project.id,
      crawl_id: crawlId,
      pages_count: snapshot.pages.length,
      elements_count: snapshot.totalElements,
      duration_ms: Date.now() - startedAtMs,
      status: 'completed',
      trigger: 'manual',
      requested_by: snapshot.requestedBy,
    },
    snapshot.pages.map((p) => ({
      project_id: project.id,
      crawl_id: crawlId,
      page_path: p.page_path,
      title: p.title,
      status_code: p.status_code,
      elements_count: p.elements_count,
      elements_fingerprint: p.elements_fingerprint,
    })),
  )

  const oldCrawlIds = await findOldCompletedCrawls(project.id, crawlId)
  if (oldCrawlIds.length === 0) return

  console.log(
    `[crawler] GC: removing ${oldCrawlIds.length} old crawl(s) for project ${project.slug}`,
  )
  for (const oldId of oldCrawlIds) {
    await deleteCrawlArtifacts(project.id, oldId)
    await deleteCrawl(oldId)
  }
}
