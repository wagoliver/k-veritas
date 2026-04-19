import { runWorkerLoop } from './worker.ts'

runWorkerLoop().catch((err) => {
  console.error('[runner] fatal', err)
  process.exit(1)
})
