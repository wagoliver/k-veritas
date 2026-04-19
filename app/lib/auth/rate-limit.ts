import 'server-only'
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/pg'

export interface BucketSpec {
  key: string
  capacity: number
  refillPerSecond: number
}

export interface BucketResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Token bucket atômico em Postgres.
 *
 * Primeiro acesso cria o bucket cheio. Leituras subsequentes reidratam
 * proporcionalmente ao tempo decorrido e consomem 1 token.
 */
export async function consumeToken(spec: BucketSpec): Promise<BucketResult> {
  const result = await db.execute<{
    tokens: number
  }>(sql`
    INSERT INTO rate_limits ("key", tokens, updated_at)
    VALUES (${spec.key}, ${spec.capacity - 1}, now())
    ON CONFLICT ("key") DO UPDATE SET
      tokens = LEAST(
        ${spec.capacity}::int,
        rate_limits.tokens + FLOOR(
          EXTRACT(EPOCH FROM (now() - rate_limits.updated_at)) * ${spec.refillPerSecond}
        )::int
      ) - 1,
      updated_at = now()
    RETURNING tokens;
  `)

  const row = result[0]
  if (!row) {
    return { allowed: false, remaining: 0, retryAfterSeconds: 60 }
  }

  if (row.tokens < 0) {
    // Reverte o decremento e devolve retry-after.
    await db.execute(sql`
      UPDATE rate_limits
      SET tokens = 0, updated_at = now()
      WHERE "key" = ${spec.key};
    `)
    const retry = Math.ceil(1 / spec.refillPerSecond)
    return { allowed: false, remaining: 0, retryAfterSeconds: retry }
  }

  return { allowed: true, remaining: row.tokens, retryAfterSeconds: 0 }
}

export const BUCKETS = {
  loginIp: (ip: string): BucketSpec => ({
    key: `login:ip:${ip}`,
    capacity: 5,
    refillPerSecond: 5 / 60,
  }),
  loginEmail: (email: string): BucketSpec => ({
    key: `login:email:${email.toLowerCase()}`,
    capacity: 10,
    refillPerSecond: 10 / 3600,
  }),
  registerIp: (ip: string): BucketSpec => ({
    key: `register:ip:${ip}`,
    capacity: 3,
    refillPerSecond: 3 / 3600,
  }),
  resetEmail: (email: string): BucketSpec => ({
    key: `reset:email:${email.toLowerCase()}`,
    capacity: 3,
    refillPerSecond: 3 / 3600,
  }),
  mfaChallenge: (challengeId: string): BucketSpec => ({
    key: `mfa:challenge:${challengeId}`,
    capacity: 5,
    refillPerSecond: 5 / 60,
  }),
  projectCreate: (orgId: string): BucketSpec => ({
    key: `project:create:${orgId}`,
    capacity: 10,
    refillPerSecond: 10 / 3600,
  }),
  crawlProject: (projectId: string): BucketSpec => ({
    key: `crawl:project:${projectId}`,
    capacity: 2,
    refillPerSecond: 1 / 30,
  }),
  aiConfigTest: (orgId: string): BucketSpec => ({
    key: `ai:config-test:${orgId}`,
    capacity: 10,
    refillPerSecond: 10 / 60,
  }),
  aiConfigWrite: (orgId: string): BucketSpec => ({
    key: `ai:config-write:${orgId}`,
    capacity: 20,
    refillPerSecond: 20 / 3600,
  }),
  aiAnalyzeProject: (projectId: string): BucketSpec => ({
    key: `ai:analyze:${projectId}`,
    capacity: 20,
    refillPerSecond: 20 / 3600,
  }),
  aiGenerateTests: (projectId: string): BucketSpec => ({
    key: `ai:gen-tests:${projectId}`,
    capacity: 30,
    refillPerSecond: 30 / 3600,
  }),
}
