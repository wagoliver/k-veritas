import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { generatedTests, projectTestRuns } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — detalhe de um run, com todos os arquivos gerados.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, runId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const [run] = await db
    .select()
    .from(projectTestRuns)
    .where(
      and(
        eq(projectTestRuns.id, runId),
        eq(projectTestRuns.projectId, project.id),
      ),
    )
    .limit(1)

  if (!run) return Problems.forbidden()

  const files = await db
    .select({
      id: generatedTests.id,
      featureId: generatedTests.featureId,
      featureNameSnapshot: generatedTests.featureNameSnapshot,
      filePath: generatedTests.filePath,
      fileContent: generatedTests.fileContent,
      scenariosJson: generatedTests.scenariosJson,
      createdAt: generatedTests.createdAt,
    })
    .from(generatedTests)
    .where(eq(generatedTests.testRunId, runId))
    .orderBy(asc(generatedTests.filePath))

  return NextResponse.json(
    {
      run: {
        id: run.id,
        status: run.status,
        provider: run.provider,
        model: run.model,
        scenariosIncludedCount: run.scenariosIncludedCount,
        featuresCount: run.featuresCount,
        filesCount: run.filesCount,
        tokensIn: run.tokensIn,
        tokensOut: run.tokensOut,
        durationMs: run.durationMs,
        error: run.error,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
      },
      files,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id, runId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const deleted = await db
    .delete(projectTestRuns)
    .where(
      and(
        eq(projectTestRuns.id, runId),
        eq(projectTestRuns.projectId, project.id),
      ),
    )
    .returning({ id: projectTestRuns.id })

  if (deleted.length === 0) return Problems.forbidden()

  await audit({
    userId: session.user.id,
    event: 'test_run_deleted',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { projectId: project.id, runId },
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
