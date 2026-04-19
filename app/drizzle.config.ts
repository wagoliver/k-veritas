import type { Config } from 'drizzle-kit'

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://kveritas:kveritas@localhost:5432/kveritas',
  },
  strict: true,
  verbose: true,
} satisfies Config
