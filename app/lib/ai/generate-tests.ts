import 'server-only'
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  analysisFeatures,
  analysisScenarios,
  crawlElements,
  crawlJobs,
  crawlPages,
  featureTestFiles,
  projectTestRuns,
  scenarioTests,
  type Project,
  type ScenarioPriority,
} from '@/lib/db/schema'
import { buildClient } from './client-factory'
import { resolveAiConfig } from './config'
import {
  buildTestGenUserMessage,
  TEST_GENERATION_SYSTEM_PROMPT,
  type TestGenPayload,
} from './test-prompts'
import {
  TestGenerationOutputSchema,
  type TestGenerationOutput,
} from './test-schemas'
import { AIProviderError } from './types'
import { sanitizeJsonResponse } from './json-sanitize'

export interface GenerateTestsOptions {
  modelOverride?: string
}

export interface GenerateTestsOutcome {
  testRunId: string
  status: 'completed' | 'failed'
  filesCount: number
  featuresCount: number
  scenariosCount: number
  durationMs: number
  tokensIn?: number
  tokensOut?: number
  error?: string
}

export async function runTestGeneration(
  project: Project,
  requestedByUserId: string,
  opts: GenerateTestsOptions = {},
): Promise<GenerateTestsOutcome> {
  const baseConfig = await resolveAiConfig(project.orgId)
  const effectiveConfig = opts.modelOverride
    ? { ...baseConfig, model: opts.modelOverride }
    : baseConfig
  const client = buildClient(effectiveConfig)
  const { provider, model } = client.config

  // Monta payload: só features que têm pelo menos um cenário revisado
  const payload = await buildTestGenPayload(project)
  if (payload.features.length === 0) {
    throw new Error('no_reviewed_scenarios')
  }

  const scenariosCount = payload.features.reduce(
    (n, f) => n + f.scenarios.length,
    0,
  )

  const [created] = await db
    .insert(projectTestRuns)
    .values({
      projectId: project.id,
      status: 'running',
      provider,
      model,
      requestedBy: requestedByUserId,
      scenariosIncludedCount: scenariosCount,
      featuresCount: payload.features.length,
      startedAt: new Date(),
    })
    .returning({ id: projectTestRuns.id })

  if (!created) throw new Error('insert_failed')
  const testRunId = created.id
  const startTime = Date.now()

  try {
    const userMessage = buildTestGenUserMessage(payload)

    let lastFlush = 0
    const response = await client.generate(
      {
        system: TEST_GENERATION_SYSTEM_PROMPT,
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
                .update(projectTestRuns)
                .set({
                  tokensOut,
                  durationMs: now - startTime,
                })
                .where(eq(projectTestRuns.id, testRunId))
            } catch {
              // heartbeat: ignora falhas intermitentes
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
      throw new TestGenParseError(
        `JSON inválido: ${(err as Error).message}`,
        sanitized,
      )
    }

    const validated = TestGenerationOutputSchema.safeParse(parsed)
    if (!validated.success) {
      throw new TestGenParseError(
        `Output não aderente ao schema: ${validated.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
        sanitized,
      )
    }

    // Persiste arquivos + snippets por scenario
    const { totalTests } = await persistGeneratedFiles(
      testRunId,
      project.id,
      validated.data,
      payload,
    )

    await db
      .update(projectTestRuns)
      .set({
        status: 'completed',
        filesCount: validated.data.files.length,
        rawResponse: response.text,
        tokensIn: response.tokensIn ?? null,
        tokensOut: response.tokensOut ?? null,
        durationMs,
        finishedAt: new Date(),
      })
      .where(eq(projectTestRuns.id, testRunId))

    // Se nenhum scenario válido foi persistido (LLM mandou só UUIDs
    // inventados), deve falhar loud pra não induzir a UI a achar que gerou
    if (totalTests === 0) {
      throw new TestGenParseError(
        'Nenhum scenarioId válido no output do LLM',
        response.text.slice(0, 2000),
      )
    }

    return {
      testRunId,
      status: 'completed',
      filesCount: validated.data.files.length,
      featuresCount: payload.features.length,
      scenariosCount,
      durationMs,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const message =
      err instanceof AIProviderError
        ? `${provider}: ${err.message}`
        : err instanceof TestGenParseError
          ? `Parse: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'unknown'

    await db
      .update(projectTestRuns)
      .set({
        status: 'failed',
        error: message.slice(0, 2000),
        rawResponse:
          err instanceof TestGenParseError ? err.rawResponse : null,
        durationMs,
        finishedAt: new Date(),
      })
      .where(eq(projectTestRuns.id, testRunId))

    return {
      testRunId,
      status: 'failed',
      filesCount: 0,
      featuresCount: payload.features.length,
      scenariosCount,
      durationMs,
      error: message,
    }
  }
}

class TestGenParseError extends Error {
  constructor(
    message: string,
    public rawResponse: string,
  ) {
    super(message)
    this.name = 'TestGenParseError'
  }
}

async function buildTestGenPayload(project: Project): Promise<TestGenPayload> {
  // Busca features que têm pelo menos 1 cenário revisado
  const reviewedFeaturesRows = await db
    .select({
      feature: analysisFeatures,
    })
    .from(analysisFeatures)
    .where(eq(analysisFeatures.projectId, project.id))
    .orderBy(asc(analysisFeatures.sortOrder))

  const allScenarios = await db
    .select()
    .from(analysisScenarios)
    .where(
      and(
        eq(analysisScenarios.projectId, project.id),
        isNotNull(analysisScenarios.reviewedAt),
      ),
    )
    .orderBy(asc(analysisScenarios.sortOrder))

  const scenariosByFeature = new Map<string, typeof allScenarios>()
  for (const s of allScenarios) {
    const arr = scenariosByFeature.get(s.featureId) ?? []
    arr.push(s)
    scenariosByFeature.set(s.featureId, arr)
  }

  // Pega último crawl completo pra extrair elementos por path
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

  const pagesByPath = new Map<
    string,
    Array<{
      kind: string
      role: string | null
      label: string | null
      selector: string
    }>
  >()

  if (lastCrawl) {
    const rows = await db
      .select({
        url: crawlPages.url,
        kind: crawlElements.kind,
        role: crawlElements.role,
        label: crawlElements.label,
        selector: crawlElements.selector,
      })
      .from(crawlPages)
      .innerJoin(crawlElements, eq(crawlElements.pageId, crawlPages.id))
      .where(eq(crawlPages.crawlId, lastCrawl.id))

    for (const r of rows) {
      const path = toPath(r.url)
      const arr = pagesByPath.get(path) ?? []
      arr.push({
        kind: r.kind,
        role: r.role,
        label: r.label,
        selector: r.selector,
      })
      pagesByPath.set(path, arr)
    }
  }

  const features: TestGenPayload['features'] = []
  for (const row of reviewedFeaturesRows) {
    const f = row.feature
    const scenarios = scenariosByFeature.get(f.id) ?? []
    if (scenarios.length === 0) continue

    const paths = (f.paths as string[]) ?? []
    const elementsByPath: TestGenPayload['features'][number]['elementsByPath'] =
      {}
    for (const p of paths) {
      const matched = pagesByPath.get(p) ?? []
      if (matched.length > 0) elementsByPath[p] = matched
    }

    features.push({
      externalId: f.externalId,
      name: f.name,
      description: f.description,
      paths,
      scenarios: scenarios.map((s) => ({
        id: s.id,
        title: s.title,
        rationale: s.rationale,
        priority: s.priority as ScenarioPriority,
        preconditions: (s.preconditions as string[]) ?? [],
        dataNeeded: (s.dataNeeded as string[]) ?? [],
      })),
      elementsByPath,
    })
  }

  return {
    project: {
      name: project.name,
      targetUrl: project.targetUrl,
      description: project.description,
      authKind: project.authKind as 'none' | 'form',
      targetLocale: project.targetLocale,
    },
    features,
  }
}

async function persistGeneratedFiles(
  testRunId: string,
  projectId: string,
  output: TestGenerationOutput,
  payload: TestGenPayload,
): Promise<{ totalTests: number }> {
  // Mapeia externalId → feature DB id pra cross-ref
  const externalToDbId = new Map<string, string>()
  const dbFeatures = await db
    .select({
      id: analysisFeatures.id,
      externalId: analysisFeatures.externalId,
    })
    .from(analysisFeatures)
    .where(eq(analysisFeatures.projectId, projectId))
  for (const f of dbFeatures) externalToDbId.set(f.externalId, f.id)

  // Dicionário scenarioId → title por feature, pra snapshot e filtro
  const scenariosById = new Map<
    string,
    { title: string; featureExternalId: string }
  >()
  for (const f of payload.features) {
    for (const s of f.scenarios) {
      scenariosById.set(s.id, {
        title: s.title,
        featureExternalId: f.externalId,
      })
    }
  }

  let totalTests = 0

  for (const file of output.files) {
    const featureDbId = externalToDbId.get(file.featureExternalId) ?? null
    const filePath = sanitizePath(file.filePath)

    // Persiste header/footer por feature
    await db.insert(featureTestFiles).values({
      projectId,
      testRunId,
      featureId: featureDbId,
      featureExternalIdSnapshot: file.featureExternalId,
      featureNameSnapshot: file.featureName,
      filePath,
      fileHeader: file.fileHeader,
      fileFooter: file.fileFooter,
    })

    // Persiste cada test() como row separado em scenario_tests
    const rows = file.tests
      .map((t) => {
        const info = scenariosById.get(t.scenarioId)
        if (!info) {
          // LLM inventou scenarioId — ignora silenciosamente (não persiste)
          console.warn(
            `[generate-tests] ignoring test with unknown scenarioId ${t.scenarioId}`,
          )
          return null
        }
        return {
          projectId,
          testRunId,
          scenarioId: t.scenarioId,
          scenarioIdSnapshot: t.scenarioId,
          featureId: featureDbId,
          featureExternalIdSnapshot: file.featureExternalId,
          featureNameSnapshot: file.featureName,
          filePath,
          code: t.code,
          titleSnapshot: info.title,
        }
      })
      .filter(
        (r): r is NonNullable<typeof r> => r !== null,
      )

    if (rows.length > 0) {
      await db.insert(scenarioTests).values(rows)
      totalTests += rows.length
    }
  }

  return { totalTests }
}

/**
 * Defende contra path traversal que o LLM pode ter gerado.
 * Aceita apenas subpaths com .spec.ts, letras/dígitos/_/-/.
 */
function sanitizePath(path: string): string {
  const cleaned = path
    .replace(/\\/g, '/')
    .replace(/\.\.\//g, '')
    .replace(/^\/+/, '')
    .slice(0, 300)
  if (!/^[A-Za-z0-9._/-]+\.spec\.ts$/.test(cleaned)) {
    // Fallback defensivo: usa hash do path original
    return `tests/${cleaned.replace(/[^A-Za-z0-9._-]/g, '_')}.spec.ts`
  }
  return cleaned
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
