import 'server-only'

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'

import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __kv_pg__: { sql: Sql; db: PostgresJsDatabase<typeof schema> } | undefined
}

function buildClient(): { sql: Sql; db: PostgresJsDatabase<typeof schema> } {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL não configurada')
  }
  const sql = postgres(url, {
    max: 10,
    idle_timeout: 20,
    prepare: false,
  })
  return { sql, db: drizzle(sql, { schema, casing: 'snake_case' }) }
}

function getClient() {
  if (!globalThis.__kv_pg__) {
    globalThis.__kv_pg__ = buildClient()
  }
  return globalThis.__kv_pg__
}

// Proxy preguiçoso: só instancia o driver na primeira chamada (evita
// falhar durante `next build`, que apenas executa os módulos de rota
// para coletar metadata, sem acessar o banco).
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = getClient().db as unknown as Record<string | symbol, unknown>
    const value = Reflect.get(real, prop, receiver)
    return typeof value === 'function' ? value.bind(real) : value
  },
})

export { schema }
