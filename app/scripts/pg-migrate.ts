import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'drizzle')

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL não configurada')

  const sql = postgres(url, { max: 1, onnotice: () => {} })

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _kv_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort()

    const applied = new Set(
      (
        await sql<{ name: string }[]>`SELECT name FROM _kv_migrations`
      ).map((r) => r.name),
    )

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[postgres] skip ${file} (already applied)`)
        continue
      }
      const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
      await sql.begin(async (tx) => {
        await tx.unsafe(content)
        await tx`INSERT INTO _kv_migrations (name) VALUES (${file})`
      })
      console.log(`[postgres] applied ${file}`)
    }

    console.log('[postgres] migrations done')
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('[postgres] migration failed:', err)
  process.exit(1)
})
