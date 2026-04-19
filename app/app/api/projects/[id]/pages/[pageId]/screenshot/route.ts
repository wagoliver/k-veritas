import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { NextRequest } from 'next/server'
import { Readable } from 'node:stream'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { crawlJobs, crawlPages } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'

/**
 * Serve screenshot do crawl via proxy autenticado.
 * Garante: user pertence à org dona do projeto dono da página.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; pageId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, pageId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const [row] = await db
    .select({
      screenshotPath: crawlPages.screenshotPath,
    })
    .from(crawlPages)
    .innerJoin(crawlJobs, eq(crawlJobs.id, crawlPages.crawlId))
    .where(and(eq(crawlPages.id, pageId), eq(crawlJobs.projectId, project.id)))
    .limit(1)

  if (!row?.screenshotPath) return Problems.forbidden()

  // Segurança: caminho deve começar com /data/projects/<project.id>/
  const allowedPrefix = `/data/projects/${project.id}/`
  if (!row.screenshotPath.startsWith(allowedPrefix)) {
    return Problems.forbidden()
  }

  try {
    const info = await stat(row.screenshotPath)
    const nodeStream = createReadStream(row.screenshotPath)
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(info.size),
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch {
    return Problems.forbidden()
  }
}
