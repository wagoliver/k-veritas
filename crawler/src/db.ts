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
    RETURNING id, project_id, requested_by
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
        (crawl_id, url, title, status_code, screenshot_path, dom_path)
      VALUES
        (${crawlId}, ${page.url}, ${page.title}, ${page.statusCode},
         ${page.screenshotPath}, ${page.domPath})
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
