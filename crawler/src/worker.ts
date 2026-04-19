import {
  claimNextJob,
  markCompleted,
  markFailed,
  requeueStaleJobs,
  savePage,
  heartbeat,
} from './db.ts'
import { collectDom } from './dom-collector.ts'

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
