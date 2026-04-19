import 'server-only'
import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  crawlElements,
  crawlJobs,
  crawlPages,
  projectAnalyses,
  projectScenarios,
  type Project,
} from '@/lib/db/schema'
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserMessage,
} from './prompts'
import { AnalysisSchema, type Analysis } from './schemas'
import { getClientForOrg } from './client-factory'
import { AIProviderError } from './types'
import { sanitizeJsonResponse } from './json-sanitize'

export interface AnalysisOutcome {
  analysisId: string
  status: 'completed' | 'failed'
  analysis?: Analysis
  error?: string
  durationMs: number
  tokensIn?: number
  tokensOut?: number
}

export async function runProjectAnalysis(
  project: Project,
  requestedByUserId: string,
): Promise<AnalysisOutcome> {
  const client = await getClientForOrg(project.orgId)
  const { provider, model } = client.config

  const [lastCrawl] = await db
    .select({ id: crawlJobs.id })
    .from(crawlJobs)
    .where(
      and(
        eq(crawlJobs.projectId, project.id),
        eq(crawlJobs.status, 'completed'),
      ),
    )
    .orderBy(desc(crawlJobs.finishedAt))
    .limit(1)

  if (!lastCrawl) {
    throw new Error('no_crawl_available')
  }

  const [created] = await db
    .insert(projectAnalyses)
    .values({
      projectId: project.id,
      crawlId: lastCrawl.id,
      status: 'running',
      provider,
      model,
      requestedBy: requestedByUserId,
      startedAt: new Date(),
    })
    .returning({ id: projectAnalyses.id })

  if (!created) throw new Error('insert_failed')
  const analysisId = created.id

  const startTime = Date.now()

  try {
    const payload = await buildProjectPayload(project, lastCrawl.id)
    const userMessage = buildAnalysisUserMessage(payload)

    const response = await client.generate({
      system: ANALYSIS_SYSTEM_PROMPT,
      prompt: userMessage,
      format: 'json',
    })

    const durationMs = Date.now() - startTime
    const sanitized = sanitizeJsonResponse(response.text)

    let parsed: unknown
    try {
      parsed = JSON.parse(sanitized)
    } catch (err) {
      throw new AnalysisParseError(
        `JSON inválido após sanitização: ${(err as Error).message}`,
        sanitized,
      )
    }

    const validated = AnalysisSchema.safeParse(parsed)
    if (!validated.success) {
      throw new AnalysisParseError(
        `Output não aderente ao schema: ${validated.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
        sanitized,
      )
    }

    await db
      .update(projectAnalyses)
      .set({
        status: 'completed',
        summary: validated.data.summary,
        inferredLocale: validated.data.inferredLocale,
        features: validated.data.features,
        rawResponse: response.text,
        durationMs,
        tokensIn: response.tokensIn ?? null,
        tokensOut: response.tokensOut ?? null,
        finishedAt: new Date(),
      })
      .where(eq(projectAnalyses.id, analysisId))

    return {
      analysisId,
      status: 'completed',
      analysis: validated.data,
      durationMs,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const message =
      err instanceof AIProviderError
        ? `${provider}: ${err.message}`
        : err instanceof AnalysisParseError
          ? `Parse: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'unknown'

    await db
      .update(projectAnalyses)
      .set({
        status: 'failed',
        error: message.slice(0, 2000),
        rawResponse:
          err instanceof AnalysisParseError ? err.rawResponse : null,
        durationMs,
        finishedAt: new Date(),
      })
      .where(eq(projectAnalyses.id, analysisId))

    return { analysisId, status: 'failed', error: message, durationMs }
  }
}

class AnalysisParseError extends Error {
  constructor(
    message: string,
    public rawResponse: string,
  ) {
    super(message)
    this.name = 'AnalysisParseError'
  }
}

async function buildProjectPayload(project: Project, crawlId: string) {
  const pages = await db
    .select({
      id: crawlPages.id,
      path: crawlPages.url,
      title: crawlPages.title,
      statusCode: crawlPages.statusCode,
      elementsCount: sql<number>`count(${crawlElements.id})::int`,
    })
    .from(crawlPages)
    .leftJoin(crawlElements, eq(crawlElements.pageId, crawlPages.id))
    .where(eq(crawlPages.crawlId, crawlId))
    .groupBy(crawlPages.id)
    .orderBy(crawlPages.discoveredAt)

  const elementsByPage = new Map<
    string,
    Array<{ kind: string; role: string | null; label: string | null }>
  >()

  for (const p of pages) {
    const els = await db
      .select({
        kind: crawlElements.kind,
        role: crawlElements.role,
        label: crawlElements.label,
      })
      .from(crawlElements)
      .where(eq(crawlElements.pageId, p.id))

    elementsByPage.set(p.id, els)
  }

  const scenarios = await db
    .select({ description: projectScenarios.description })
    .from(projectScenarios)
    .where(eq(projectScenarios.projectId, project.id))
    .orderBy(asc(projectScenarios.priority))

  return {
    name: project.name,
    targetUrl: project.targetUrl,
    description: project.description,
    scenarios: scenarios.map((s) => s.description),
    pages: pages.map((p) => ({
      path: toPath(p.path),
      title: p.title,
      statusCode: p.statusCode,
      elementsCount: p.elementsCount ?? 0,
      elements: elementsByPage.get(p.id) ?? [],
    })),
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
