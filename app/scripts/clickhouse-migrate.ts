import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@clickhouse/client'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'clickhouse')

async function main(): Promise<void> {
  const client = createClient({
    url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER ?? 'default',
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
  })

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file)
    const content = await readFile(path, 'utf8')

    // Remove linhas de comentário (`-- ...`) antes do split, pra que
    // statements iniciados por comentário não sejam descartados.
    const stripped = content
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')

    const statements = stripped
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    console.log(`[clickhouse] ${file} (${statements.length} statements)`)

    for (const stmt of statements) {
      await client.command({ query: stmt })
    }
  }

  await client.close()
  console.log('[clickhouse] migrations applied')
}

main().catch((err) => {
  console.error('[clickhouse] migration failed:', err)
  process.exit(1)
})
