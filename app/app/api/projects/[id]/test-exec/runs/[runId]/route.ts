import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq, inArray } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  testExecResults,
  testExecRuns,
  testExecStepEvents,
} from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — detalhe de um run + resultados por cenário + timeline de steps.
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
    .from(testExecRuns)
    .where(
      and(
        eq(testExecRuns.id, runId),
        eq(testExecRuns.projectId, project.id),
      ),
    )
    .limit(1)

  if (!run) return Problems.forbidden()

  const results = await db
    .select({
      id: testExecResults.id,
      scenarioId: testExecResults.scenarioId,
      scenarioIdSnapshot: testExecResults.scenarioIdSnapshot,
      titleSnapshot: testExecResults.titleSnapshot,
      status: testExecResults.status,
      durationMs: testExecResults.durationMs,
      errorMessage: testExecResults.errorMessage,
      errorStack: testExecResults.errorStack,
      tracePath: testExecResults.tracePath,
      screenshotPath: testExecResults.screenshotPath,
      videoPath: testExecResults.videoPath,
      createdAt: testExecResults.createdAt,
    })
    .from(testExecResults)
    .where(eq(testExecResults.runId, runId))
    .orderBy(asc(testExecResults.createdAt))

  // Timeline de steps por result (fetch em lote, agrupado no cliente-servidor)
  const events =
    results.length > 0
      ? await db
          .select({
            resultId: testExecStepEvents.resultId,
            stepIndex: testExecStepEvents.stepIndex,
            title: testExecStepEvents.title,
            status: testExecStepEvents.status,
            durationMs: testExecStepEvents.durationMs,
            errorMessage: testExecStepEvents.errorMessage,
            lineInSpec: testExecStepEvents.lineInSpec,
            startedAt: testExecStepEvents.startedAt,
            finishedAt: testExecStepEvents.finishedAt,
          })
          .from(testExecStepEvents)
          .where(
            inArray(
              testExecStepEvents.resultId,
              results.map((r) => r.id),
            ),
          )
          .orderBy(
            asc(testExecStepEvents.resultId),
            asc(testExecStepEvents.stepIndex),
          )
      : []

  const eventsByResult = new Map<string, typeof events>()
  for (const ev of events) {
    const arr = eventsByResult.get(ev.resultId) ?? []
    arr.push(ev)
    eventsByResult.set(ev.resultId, arr)
  }

  // Transforma paths absolutos em URLs relativas da API pra a UI consumir
  // direto como <img src>. O endpoint de artefatos valida sessão + projeto.
  const artifactUrl = (absolutePath: string | null): string | null => {
    if (!absolutePath) return null
    const marker = `/exec/${runId}/`
    const idx = absolutePath.indexOf(marker)
    if (idx < 0) return null
    const relative = absolutePath.slice(idx + marker.length)
    if (!relative) return null
    // Normaliza backslash (Windows dev) pra forward slash
    const segments = relative
      .split(/[\\/]/)
      .filter((s) => s && s !== '.' && s !== '..')
    return `/api/projects/${project.id}/test-exec/runs/${runId}/artifacts/${segments.join('/')}`
  }

  const resultsWithEvents = results.map((r) => ({
    ...r,
    screenshotUrl: artifactUrl(r.screenshotPath),
    traceUrl: artifactUrl(r.tracePath),
    videoUrl: artifactUrl(r.videoPath),
    stepEvents: (eventsByResult.get(r.id) ?? []).map((ev) => ({
      stepIndex: ev.stepIndex,
      title: ev.title,
      status: ev.status,
      durationMs: ev.durationMs,
      errorMessage: ev.errorMessage,
      lineInSpec: ev.lineInSpec,
      startedAt: ev.startedAt,
      finishedAt: ev.finishedAt,
    })),
  }))

  return NextResponse.json(
    {
      run: {
        id: run.id,
        scope: run.scope,
        scopeId: run.scopeId,
        status: run.status,
        scenariosCount: run.scenariosCount,
        passedCount: run.passedCount,
        failedCount: run.failedCount,
        error: run.error,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
      },
      results: resultsWithEvents,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
