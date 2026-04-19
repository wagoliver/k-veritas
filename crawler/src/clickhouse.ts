import { createClient, type ClickHouseClient } from '@clickhouse/client'

import { env } from './env.ts'

let client: ClickHouseClient | null = null

function getClient(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: env('CLICKHOUSE_URL', 'http://clickhouse:8123'),
      database: env('CLICKHOUSE_DB', 'kveritas'),
      username: env('CLICKHOUSE_USER', 'default'),
      password: env('CLICKHOUSE_PASSWORD', ''),
      request_timeout: 10_000,
    })
  }
  return client
}

export interface CrawlRunRow {
  project_id: string
  crawl_id: string
  pages_count: number
  elements_count: number
  duration_ms: number
  status: 'completed' | 'failed' | 'cancelled'
  trigger: 'manual' | 'auto' | 'scheduled'
  requested_by: string | null
}

export interface CrawlPageHistoryRow {
  project_id: string
  crawl_id: string
  page_path: string
  title: string
  status_code: number
  elements_count: number
  elements_fingerprint: string
}

/**
 * Grava o resumo de um crawl + snapshot por página no ClickHouse.
 * Essas duas escritas são a "fonte de verdade histórica". Se falharem,
 * o caller NÃO deve apagar as linhas correspondentes no Postgres.
 */
export async function recordCrawlHistory(
  run: CrawlRunRow,
  pages: CrawlPageHistoryRow[],
): Promise<void> {
  const ch = getClient()
  await ch.insert({
    table: 'crawl_runs',
    values: [run],
    format: 'JSONEachRow',
  })
  if (pages.length > 0) {
    await ch.insert({
      table: 'crawl_page_history',
      values: pages,
      format: 'JSONEachRow',
    })
  }
}
