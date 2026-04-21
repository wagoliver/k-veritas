import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import { db } from '@/lib/db/pg'
import { testExecRuns } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATA_DIR = process.env.DATA_DIR ?? '/data'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.zip': 'application/zip',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
}

/**
 * Serve artefatos gerados pelo runner (screenshots, trace.zip, etc.)
 * com auth de sessão + validação de propriedade do run + anti path-traversal.
 *
 * Layout em disco: /data/projects/<projectId>/exec/<runId>/...
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string; path: string[] }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, runId, path } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  // Garante que o run pertence ao projeto da sessão.
  const [run] = await db
    .select({ id: testExecRuns.id })
    .from(testExecRuns)
    .where(
      and(eq(testExecRuns.id, runId), eq(testExecRuns.projectId, project.id)),
    )
    .limit(1)
  if (!run) return Problems.forbidden()

  if (!Array.isArray(path) || path.length === 0) {
    return Problems.invalidBody()
  }

  // Anti path-traversal: resolve absoluto, verifica prefixo, rejeita
  // qualquer coisa fora da pasta do run.
  const baseDir = resolve(
    join(DATA_DIR, 'projects', project.id, 'exec', runId),
  )
  const requested = resolve(baseDir, ...path.map((seg) => normalize(seg)))
  if (requested !== baseDir && !requested.startsWith(baseDir + sep)) {
    return Problems.forbidden()
  }

  let fileInfo
  try {
    fileInfo = await stat(requested)
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!fileInfo.isFile()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const ext = extname(requested).toLowerCase()
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'

  // HEAD: só headers, sem corpo (útil pra UI checar se o arquivo existe).
  if (req.method === 'HEAD') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileInfo.size),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  }

  const nodeStream = createReadStream(requested)
  const webStream = Readable.toWeb(nodeStream) as NodeReadableStream<Uint8Array>

  return new NextResponse(webStream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileInfo.size),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
