import {
  claimNextJob,
  heartbeat,
  loadScenarioExecData,
  markRunCompleted,
  markRunFailed,
  requeueStaleJobs,
} from './db.ts'
import { executeScenarioJob } from './executor.ts'
import { env } from './env.ts'

const WORKER_ID = `runner-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
const POLL_INTERVAL_MS = Number(process.env.RUNNER_POLL_MS ?? 2000)
const STALE_TIMEOUT_SECONDS = Number(process.env.RUNNER_STALE_SECONDS ?? 900)
const PW_TIMEOUT_MS = Number(process.env.RUNNER_PW_TIMEOUT_MS ?? 120_000)
const PW_ACTION_TIMEOUT_MS = Number(
  process.env.RUNNER_PW_ACTION_TIMEOUT_MS ?? 15_000,
)
const PW_NAV_TIMEOUT_MS = Number(
  process.env.RUNNER_PW_NAV_TIMEOUT_MS ?? 30_000,
)
const WORK_DIR = env('WORK_DIR', '/work')
const DATA_DIR = env('DATA_DIR', '/data')

let stopping = false
process.on('SIGTERM', () => {
  stopping = true
})
process.on('SIGINT', () => {
  stopping = true
})

export async function runWorkerLoop(): Promise<void> {
  console.log(`[runner] ${WORKER_ID} starting`)
  let lastReQueueAt = 0

  while (!stopping) {
    try {
      const now = Date.now()
      if (now - lastReQueueAt > 60_000) {
        const requeued = await requeueStaleJobs(STALE_TIMEOUT_SECONDS)
        if (requeued > 0) {
          console.log(`[runner] requeued ${requeued} stale job(s)`)
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
        `[runner] job ${job.id} scope=${job.scope} scope_id=${job.scope_id} project=${project.id}`,
      )

      const heartbeatTimer = setInterval(
        () => heartbeat(job.id, WORKER_ID).catch(() => {}),
        15_000,
      )

      try {
        if (job.scope !== 'scenario' || !job.scope_id) {
          throw new Error(
            `unsupported scope in 3.a: ${job.scope} (scenario only)`,
          )
        }

        const scenario = await loadScenarioExecData(project.id, job.scope_id)
        if (!scenario) {
          throw new Error('scenario has no generated test yet')
        }

        const results = await executeScenarioJob(job, project, scenario, {
          workDir: WORK_DIR,
          dataDir: DATA_DIR,
          playwrightTimeoutMs: PW_TIMEOUT_MS,
          actionTimeoutMs: PW_ACTION_TIMEOUT_MS,
          navigationTimeoutMs: PW_NAV_TIMEOUT_MS,
        })

        await markRunCompleted(job.id, project.id, 1, results)
        console.log(
          `[runner] job ${job.id} done: ${results.map((r) => r.status).join(', ')}`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[runner] job ${job.id} failed:`, msg)
        await markRunFailed(job.id, msg)
      } finally {
        clearInterval(heartbeatTimer)
      }
    } catch (err) {
      console.error('[runner] loop error:', err)
      await sleep(POLL_INTERVAL_MS)
    }
  }

  console.log('[runner] stopping')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
