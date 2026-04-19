import 'server-only'
import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  analysisFeatures,
  analysisScenarios,
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
import { buildClient } from './client-factory'
import { resolveAiConfig } from './config'
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

export interface RunAnalysisOptions {
  /**
   * Override do modelo configurado na org para esta rodada específica.
   * Útil pra pedir "qualidade máxima" (Opus) num produto crítico sem mudar
   * o default da org.
   */
  modelOverride?: string
}

export async function runProjectAnalysis(
  project: Project,
  requestedByUserId: string,
  opts: RunAnalysisOptions = {},
): Promise<AnalysisOutcome> {
  const baseConfig = (await resolveAiConfig(project.orgId))
  const effectiveConfig = opts.modelOverride
    ? { ...baseConfig, model: opts.modelOverride }
    : baseConfig
  const client = buildClient(effectiveConfig)
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

    // Heartbeat: enquanto o provider stream, gravamos tokens_out + duracao
    // a cada ~1s no row running — a UI fica polling esse row.
    let lastFlush = 0
    const response = await client.generate(
      {
        system: ANALYSIS_SYSTEM_PROMPT,
        prompt: userMessage,
        format: 'json',
      },
      {
        onProgress: ({ tokensOut, done }) => {
          const now = Date.now()
          if (!done && now - lastFlush < 1000) return
          lastFlush = now
          void (async () => {
            try {
              await db
                .update(projectAnalyses)
                .set({
                  tokensOut,
                  durationMs: now - startTime,
                })
                .where(eq(projectAnalyses.id, analysisId))
            } catch {
              // heartbeat: ignorar falhas intermitentes de conexão
            }
          })()
        },
      },
    )

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

    // Popula a working copy editável. MVP: wipe + reinsert.
    // Preserva entradas `source='manual'` (scenarios adicionados pelo humano)
    // e entradas marcadas como `reviewed_at` (revisadas) — não devem ser
    // perdidas numa reanálise.
    await populateEditableWorkingCopy(
      project.id,
      analysisId,
      validated.data.features,
    )

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
    targetLocale: project.targetLocale,
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

/**
 * Seed da working copy a partir de uma análise existente (jsonb).
 * Usado quando o GET detecta tabelas vazias mas há análise completada.
 * Idempotente — só popula se não existe nada.
 */
export async function seedEditableFromLatestAnalysis(
  projectId: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: analysisFeatures.id })
    .from(analysisFeatures)
    .where(eq(analysisFeatures.projectId, projectId))
    .limit(1)
  if (existing) return false

  const [latest] = await db
    .select({
      id: projectAnalyses.id,
      features: projectAnalyses.features,
    })
    .from(projectAnalyses)
    .where(
      and(
        eq(projectAnalyses.projectId, projectId),
        eq(projectAnalyses.status, 'completed'),
      ),
    )
    .orderBy(desc(projectAnalyses.finishedAt))
    .limit(1)

  if (!latest) return false

  const validated = AnalysisSchema.shape.features.safeParse(latest.features)
  if (!validated.success) return false

  await populateEditableWorkingCopy(projectId, latest.id, validated.data)
  return true
}

/**
 * Sincroniza a working copy das features/cenários editáveis com a nova
 * análise, preservando itens que o humano revisou ou adicionou manualmente.
 *
 * Regras:
 *   - Features `source='manual'` NUNCA são apagadas (humano criou)
 *   - Features AI com `reviewed_at` preservam seu conteúdo atual (não
 *     sobrescreve o trabalho da curadoria); apenas re-associa ao novo
 *     `sourceAnalysisId` pra rastreabilidade
 *   - Features AI não-revisadas são substituídas pelas novas sugestões
 *   - Features AI que sumiram da nova análise e não foram revisadas são
 *     apagadas (elimina lixo)
 *   - Cenários seguem a mesma lógica dentro de cada feature
 */
async function populateEditableWorkingCopy(
  projectId: string,
  analysisId: string,
  features: Analysis['features'],
): Promise<void> {
  await db.transaction(async (tx) => {
    // Carrega snapshot atual: ids existentes + flags reviewed/source
    const existingFeatures = await tx
      .select({
        id: analysisFeatures.id,
        externalId: analysisFeatures.externalId,
        reviewedAt: analysisFeatures.reviewedAt,
        source: analysisFeatures.source,
      })
      .from(analysisFeatures)
      .where(eq(analysisFeatures.projectId, projectId))

    const keepFeatureIds = new Set<string>()
    const existingByExternal = new Map(
      existingFeatures.map((f) => [f.externalId, f]),
    )

    // Manuais: sempre preserva
    for (const f of existingFeatures) {
      if (f.source === 'manual') keepFeatureIds.add(f.id)
    }

    for (let i = 0; i < features.length; i++) {
      const incoming = features[i]
      const existing = existingByExternal.get(incoming.id)

      if (existing && existing.reviewedAt) {
        // Feature revisada: preserva conteúdo, só re-aponta pro analysis novo
        keepFeatureIds.add(existing.id)
        await tx
          .update(analysisFeatures)
          .set({
            sourceAnalysisId: analysisId,
            sortOrder: i,
            updatedAt: new Date(),
          })
          .where(eq(analysisFeatures.id, existing.id))
        continue
      }

      if (existing) {
        // Feature AI não-revisada: atualiza com conteúdo novo
        keepFeatureIds.add(existing.id)
        await tx
          .update(analysisFeatures)
          .set({
            sourceAnalysisId: analysisId,
            name: incoming.name,
            description: incoming.description,
            paths: incoming.paths,
            sortOrder: i,
            updatedAt: new Date(),
          })
          .where(eq(analysisFeatures.id, existing.id))
        await replaceAiScenariosForFeature(
          tx,
          existing.id,
          projectId,
          incoming.scenarios,
        )
        continue
      }

      // Feature nova
      const [created] = await tx
        .insert(analysisFeatures)
        .values({
          projectId,
          sourceAnalysisId: analysisId,
          externalId: incoming.id,
          name: incoming.name,
          description: incoming.description,
          paths: incoming.paths,
          sortOrder: i,
          source: 'ai',
        })
        .returning({ id: analysisFeatures.id })
      if (!created) continue
      keepFeatureIds.add(created.id)

      if (incoming.scenarios.length > 0) {
        await tx.insert(analysisScenarios).values(
          incoming.scenarios.map((s, idx) => ({
            featureId: created.id,
            projectId,
            title: s.title,
            rationale: s.rationale,
            priority: s.priority,
            preconditions: s.preconditions ?? [],
            dataNeeded: s.dataNeeded ?? [],
            sortOrder: idx,
            source: 'ai' as const,
          })),
        )
      }
    }

    // Apaga features AI não-revisadas que sumiram
    const toDelete = existingFeatures.filter(
      (f) =>
        !keepFeatureIds.has(f.id) &&
        f.source === 'ai' &&
        f.reviewedAt === null,
    )
    for (const f of toDelete) {
      await tx
        .delete(analysisFeatures)
        .where(eq(analysisFeatures.id, f.id))
    }
  })
}

/**
 * Substitui os cenários de uma feature preservando cenários manuais e
 * cenários AI já revisados.
 */
async function replaceAiScenariosForFeature(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  featureId: string,
  projectId: string,
  incoming: Analysis['features'][number]['scenarios'],
): Promise<void> {
  const existing = await tx
    .select({
      id: analysisScenarios.id,
      title: analysisScenarios.title,
      reviewedAt: analysisScenarios.reviewedAt,
      source: analysisScenarios.source,
    })
    .from(analysisScenarios)
    .where(eq(analysisScenarios.featureId, featureId))

  // Remove AI não-revisados (serão re-inseridos com o conteúdo novo)
  const toDelete = existing.filter(
    (s) => s.source === 'ai' && s.reviewedAt === null,
  )
  for (const s of toDelete) {
    await tx.delete(analysisScenarios).where(eq(analysisScenarios.id, s.id))
  }

  // Calcula sort_order que começa após os preservados
  const preserved = existing.filter(
    (s) => s.source === 'manual' || s.reviewedAt !== null,
  )
  const startOrder = preserved.length

  if (incoming.length === 0) return
  await tx.insert(analysisScenarios).values(
    incoming.map((s, idx) => ({
      featureId,
      projectId,
      title: s.title,
      rationale: s.rationale,
      priority: s.priority,
      preconditions: s.preconditions ?? [],
      dataNeeded: s.dataNeeded ?? [],
      sortOrder: startOrder + idx,
      source: 'ai' as const,
    })),
  )
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
