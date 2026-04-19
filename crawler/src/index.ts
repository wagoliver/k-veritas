import { runWorkerLoop } from './worker.ts'

runWorkerLoop().catch((err) => {
  console.error('[crawler] fatal:', err)
  process.exit(1)
})
