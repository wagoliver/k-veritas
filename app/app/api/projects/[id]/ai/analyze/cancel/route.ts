import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { projectAnalyses } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cancela (marca como failed) qualquer análise em status `running` ou `pending`.
 * O worker inflight continua rodando (fetch em curso não é abortável do
 * nosso lado), mas o resultado final é descartado quando tentar gravar.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const rows = await db
    .update(projectAnalyses)
    .set({
      status: 'failed',
      error: 'cancelled_by_user',
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(projectAnalyses.projectId, project.id),
        eq(projectAnalyses.status, 'running'),
      ),
    )
    .returning({ id: projectAnalyses.id })

  await audit({
    userId: session.user.id,
    event: 'ai_analyze_cancelled',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { projectId: project.id, cancelled: rows.length },
    outcome: 'success',
  })

  return NextResponse.json(
    { cancelled: rows.length },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
