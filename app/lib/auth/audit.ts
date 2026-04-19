import 'server-only'

import { db } from '@/lib/db/pg'
import { auditLog } from '@/lib/db/schema'
import { recordAuthEvent } from '@/lib/db/clickhouse'
import { hashEmail } from './tokens'

export interface AuditInput {
  userId?: string | null
  event: string
  meta?: Record<string, unknown>
  ip: string
  userAgent: string
  email?: string
  outcome?: 'success' | 'failure' | 'blocked'
}

/**
 * Grava no Postgres (transacional, durável) e na trilha ClickHouse
 * (volume alto, fire-and-forget). Falha no ClickHouse não derruba
 * o fluxo de auth.
 */
export async function audit(input: AuditInput): Promise<void> {
  await db.insert(auditLog).values({
    userId: input.userId ?? null,
    event: input.event,
    meta: (input.meta ?? {}) as Record<string, unknown>,
    ipInet: input.ip,
    userAgent: input.userAgent.slice(0, 512),
  })

  recordAuthEvent({
    event_type: input.event,
    user_id: input.userId ?? null,
    email_hash: input.email ? hashEmail(input.email) : '0'.repeat(64),
    ip_inet: input.ip,
    user_agent: input.userAgent.slice(0, 512),
    outcome: input.outcome ?? 'success',
    meta: input.meta,
  })
}
