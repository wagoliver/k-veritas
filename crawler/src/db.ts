import postgres from 'postgres'

import { requireEnv } from './env.ts'

export const sql = postgres(requireEnv('DATABASE_URL'), {
  max: 5,
  idle_timeout: 20,
  prepare: false,
})

export interface PendingJob {
  id: string
  project_id: string
  requested_by: string
  scope: 'full' | 'single_path'
  scope_url: string | null
}

export interface Project {
  id: string
  org_id: string
  name: string
  slug: string
  target_url: string
  auth_kind: 'none' | 'form'
  auth_credentials: Buffer | null
  status: string
  crawl_max_depth: number
}

export async function claimNextJob(
  workerId: string,
): Promise<{ job: PendingJob; project: Project } | null> {
  const rows = await sql<PendingJob[]>`
    UPDATE crawl_jobs SET
      status = 'running',
      locked_by = ${workerId},
      locked_at = now(),
      started_at = now()
    WHERE id = (
      SELECT id FROM crawl_jobs
      WHERE status = 'pending'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, project_id, requested_by, scope, scope_url
  `

  const job = rows[0]
  if (!job) return null

  const projectRows = await sql<Project[]>`
    SELECT id, org_id, name, slug, target_url, auth_kind, auth_credentials,
           status, crawl_max_depth
    FROM projects WHERE id = ${job.project_id} LIMIT 1
  `
  const project = projectRows[0]
  if (!project) {
    await sql`
      UPDATE crawl_jobs SET status='failed', finished_at=now(), error='project_not_found'
      WHERE id = ${job.id}
    `
    return null
  }

  return { job, project }
}

export async function heartbeat(jobId: string, workerId: string): Promise<void> {
  await sql`
    UPDATE crawl_jobs SET locked_at = now()
    WHERE id = ${jobId} AND locked_by = ${workerId}
  `
}

export async function markCompleted(
  jobId: string,
  projectId: string,
  pagesCount: number,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      UPDATE crawl_jobs SET
        status='completed', finished_at=now(), pages_count=${pagesCount}
      WHERE id=${jobId}
    `
    await tx`
      UPDATE projects SET status='ready', updated_at=now() WHERE id=${projectId}
    `
  })
}

export async function markFailed(
  jobId: string,
  projectId: string,
  error: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      UPDATE crawl_jobs SET
        status='failed', finished_at=now(), error=${error.slice(0, 1000)}
      WHERE id=${jobId}
    `
    await tx`
      UPDATE projects SET status='failed', updated_at=now() WHERE id=${projectId}
    `
  })
}

export async function requeueStaleJobs(timeoutSeconds: number): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE crawl_jobs SET
      status='pending', locked_by=NULL, locked_at=NULL
    WHERE status='running'
      AND locked_at IS NOT NULL
      AND locked_at < now() - ${timeoutSeconds} * INTERVAL '1 second'
    RETURNING id
  `
  return rows.length
}

export interface SavedPageInput {
  url: string
  title: string | null
  statusCode: number | null
  screenshotPath: string | null
  domPath: string | null
  /** URL final quando o site redirecionou (ex: /register → /). Null
   *  quando a URL visitada bate com a solicitada. Quando != null, a UI
   *  mostra "redirecionou pra X" e a extração de elementos é pulada. */
  redirectedTo: string | null
  elements: Array<{
    kind: string
    role: string | null
    label: string | null
    selector: string
    meta?: Record<string, unknown>
  }>
}

export async function savePage(
  crawlId: string,
  page: SavedPageInput,
): Promise<void> {
  await sql.begin(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO crawl_pages
        (crawl_id, url, title, status_code, screenshot_path, dom_path, redirected_to)
      VALUES
        (${crawlId}, ${page.url}, ${page.title}, ${page.statusCode},
         ${page.screenshotPath}, ${page.domPath}, ${page.redirectedTo})
      RETURNING id
    `
    const pageId = inserted[0]?.id
    if (!pageId) return

    if (page.elements.length > 0) {
      const values = page.elements.map((e) => ({
        page_id: pageId,
        kind: e.kind,
        role: e.role,
        label: e.label,
        selector: e.selector,
        meta: e.meta ?? {},
      }))
      await tx`INSERT INTO crawl_elements ${tx(values)}`
    }
  })
}

/**
 * UPSERT de uma única page em um crawl existente. Usado pelo re-crawler
 * de path único: se já existe crawl_pages com mesma url+crawl_id, substitui
 * os elementos; caso contrário, cria. Garante que não acumule duplicatas.
 */
export async function upsertPage(
  crawlId: string,
  page: SavedPageInput,
): Promise<void> {
  await sql.begin(async (tx) => {
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM crawl_pages
      WHERE crawl_id = ${crawlId} AND url = ${page.url}
      LIMIT 1
    `

    let pageId: string | undefined
    if (existing[0]) {
      pageId = existing[0].id
      await tx`
        UPDATE crawl_pages SET
          title = ${page.title},
          status_code = ${page.statusCode},
          screenshot_path = ${page.screenshotPath},
          dom_path = ${page.domPath},
          redirected_to = ${page.redirectedTo},
          discovered_at = now()
        WHERE id = ${pageId}
      `
      await tx`DELETE FROM crawl_elements WHERE page_id = ${pageId}`
    } else {
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO crawl_pages
          (crawl_id, url, title, status_code, screenshot_path, dom_path, redirected_to)
        VALUES
          (${crawlId}, ${page.url}, ${page.title}, ${page.statusCode},
           ${page.screenshotPath}, ${page.domPath}, ${page.redirectedTo})
        RETURNING id
      `
      pageId = inserted[0]?.id
    }

    if (!pageId) return
    if (page.elements.length > 0) {
      const values = page.elements.map((e) => ({
        page_id: pageId,
        kind: e.kind,
        role: e.role,
        label: e.label,
        selector: e.selector,
        meta: e.meta ?? {},
      }))
      await tx`INSERT INTO crawl_elements ${tx(values)}`
    }
  })
}

/**
 * Acha o crawl completed mais recente do projeto. O re-crawler de path
 * único anexa nele em vez de criar seu próprio conjunto de páginas.
 */
export async function findLatestCompletedCrawl(
  projectId: string,
): Promise<string | null> {
  // Só crawls FULL contam como "base" pra upsert. Ignora single_path
  // (que não tem pages próprias — refere ao crawl full).
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM crawl_jobs
    WHERE project_id = ${projectId}
      AND status = 'completed'
      AND scope = 'full'
    ORDER BY finished_at DESC NULLS LAST
    LIMIT 1
  `
  return rows[0]?.id ?? null
}

/**
 * Marca um job single_path como concluído. Diferente de markCompleted:
 *   - Não mexe no status do projeto (não é um crawl full)
 *   - pages_count reflete o número de paths re-crawleados (sempre 1 ou 0)
 */
export async function markSinglePathCompleted(
  jobId: string,
  pagesCount: number,
): Promise<void> {
  await sql`
    UPDATE crawl_jobs SET
      status='completed', finished_at=now(), pages_count=${pagesCount}
    WHERE id=${jobId}
  `
}

export async function markSinglePathFailed(
  jobId: string,
  error: string,
): Promise<void> {
  await sql`
    UPDATE crawl_jobs SET
      status='failed', finished_at=now(), error=${error.slice(0, 1000)}
    WHERE id=${jobId}
  `
}

export interface CrawlHistorySnapshot {
  requestedBy: string | null
  pages: Array<{
    page_path: string
    title: string
    status_code: number
    elements_count: number
    elements_fingerprint: string
  }>
  totalElements: number
}

/**
 * Lê páginas + elementos do crawl e constrói um snapshot pro histórico.
 * Calcula fingerprint por página (SHA-1 da lista ordenada de elementos).
 */
export async function fetchCrawlForHistory(
  crawlId: string,
): Promise<CrawlHistorySnapshot> {
  const { createHash } = await import('node:crypto')

  const jobRows = await sql<{ requested_by: string | null }[]>`
    SELECT requested_by FROM crawl_jobs WHERE id = ${crawlId} LIMIT 1
  `

  const pages = await sql<
    {
      id: string
      url: string
      title: string | null
      status_code: number | null
    }[]
  >`
    SELECT id, url, title, status_code
    FROM crawl_pages WHERE crawl_id = ${crawlId}
    ORDER BY discovered_at
  `

  const snapshots: CrawlHistorySnapshot['pages'] = []
  let totalElements = 0

  for (const p of pages) {
    const elements = await sql<
      { kind: string; role: string | null; label: string | null }[]
    >`
      SELECT kind, role, label FROM crawl_elements WHERE page_id = ${p.id}
      ORDER BY kind, role NULLS LAST, label NULLS LAST
    `
    totalElements += elements.length

    const hash = createHash('sha1')
    for (const e of elements) {
      hash.update(`${e.kind}|${e.role ?? ''}|${e.label ?? ''}\n`)
    }

    snapshots.push({
      page_path: toPath(p.url),
      title: p.title ?? '',
      status_code: p.status_code ?? 0,
      elements_count: elements.length,
      elements_fingerprint: hash.digest('hex'),
    })
  }

  return {
    requestedBy: jobRows[0]?.requested_by ?? null,
    pages: snapshots,
    totalElements,
  }
}

function toPath(urlStr: string): string {
  try {
    const u = new URL(urlStr)
    const p = u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '')
    return p + u.search
  } catch {
    return urlStr
  }
}

/**
 * Retorna crawls completed antigos do projeto (exceto o crawl que acabou
 * de ser concluído). Usado pra GC após gravar histórico no ClickHouse.
 */
export async function findOldCompletedCrawls(
  projectId: string,
  keepCrawlId: string,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM crawl_jobs
    WHERE project_id = ${projectId}
      AND status = 'completed'
      AND id != ${keepCrawlId}
  `
  return rows.map((r) => r.id)
}

/**
 * Apaga um crawl_job do Postgres. A CASCADE configurada via FK remove
 * crawl_pages e crawl_elements automaticamente.
 */
export async function deleteCrawl(crawlId: string): Promise<void> {
  await sql`DELETE FROM crawl_jobs WHERE id = ${crawlId}`
}
