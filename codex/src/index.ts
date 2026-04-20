import { runWorkerLoop } from './worker.ts'

runWorkerLoop().catch((err) => {
  console.error('[codex] fatal:', err)
  process.exit(1)
})
