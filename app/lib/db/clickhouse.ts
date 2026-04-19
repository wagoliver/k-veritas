import 'server-only'

import { createClient, type ClickHouseClient } from '@clickhouse/client'

declare global {
  // eslint-disable-next-line no-var
  var __kv_ch__: ClickHouseClient | undefined
}

function build(): ClickHouseClient {
  return createClient({
    url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
    database: process.env.CLICKHOUSE_DB ?? 'kveritas',
    username: process.env.CLICKHOUSE_USER ?? 'default',
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
    request_timeout: 5_000,
    compression: { request: false, response: true },
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
    },
  })
}

function getClient(): ClickHouseClient {
  if (!globalThis.__kv_ch__) {
    globalThis.__kv_ch__ = build()
  }
  return globalThis.__kv_ch__
}

export type AuthEvent = {
  event_type: string
  user_id?: string | null
  email_hash: string
  ip_inet: string
  user_agent: string
  outcome: 'success' | 'failure' | 'blocked'
  meta?: Record<string, unknown>
}

/**
 * Fire-and-forget: escreve no ClickHouse em background.
 * Falha é logada mas não quebra o fluxo de auth.
 */
export function recordAuthEvent(event: AuthEvent): void {
  const values = [
    {
      event_type: event.event_type,
      user_id: event.user_id ?? null,
      email_hash: event.email_hash,
      ip_inet: event.ip_inet,
      user_agent: event.user_agent,
      outcome: event.outcome,
      meta: JSON.stringify(event.meta ?? {}),
    },
  ]

  getClient()
    .insert({
      table: 'auth_events',
      values,
      format: 'JSONEachRow',
    })
    .catch((err) => {
      console.error('[clickhouse] recordAuthEvent failed', err)
    })
}

export interface ReviewEvent {
  project_id: string
  target_kind: 'feature' | 'scenario'
  target_id: string
  action: 'marked' | 'unmarked'
  user_id: string
  user_display: string
  title_snapshot: string
}

/**
 * Grava evento de revisão (marcar/desmarcar) no ClickHouse.
 * Fire-and-forget. Postgres já tem a fonte de verdade do estado atual
 * (reviewed_at + reviewed_by); o CH é pra auditoria temporal.
 */
export function recordReviewEvent(event: ReviewEvent): void {
  getClient()
    .insert({
      table: 'analysis_review_events',
      values: [event],
      format: 'JSONEachRow',
    })
    .catch((err) => {
      console.error('[clickhouse] recordReviewEvent failed', err)
    })
}

/**
 * Mutação assíncrona no ClickHouse: apaga todo o histórico de crawls
 * de um projeto. Fire-and-forget — a mutação é processada em background
 * pelo CH. Se falhar, dados órfãos ficam até o TTL de 2 anos limpar.
 */
export function purgeProjectCrawlHistory(projectId: string): void {
  const ch = getClient()
  void Promise.all([
    ch
      .command({
        query: `ALTER TABLE crawl_runs DELETE WHERE project_id = {pid:UUID}`,
        query_params: { pid: projectId },
      })
      .catch((err) =>
        console.error('[clickhouse] purge crawl_runs failed', err),
      ),
    ch
      .command({
        query: `ALTER TABLE crawl_page_history DELETE WHERE project_id = {pid:UUID}`,
        query_params: { pid: projectId },
      })
      .catch((err) =>
        console.error('[clickhouse] purge crawl_page_history failed', err),
      ),
    ch
      .command({
        query: `ALTER TABLE analysis_review_events DELETE WHERE project_id = {pid:UUID}`,
        query_params: { pid: projectId },
      })
      .catch((err) =>
        console.error(
          '[clickhouse] purge analysis_review_events failed',
          err,
        ),
      ),
  ])
}
