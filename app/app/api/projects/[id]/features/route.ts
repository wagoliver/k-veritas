import { NextResponse, type NextRequest } from 'next/server'
import { asc, eq, max } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { db } from '@/lib/db/pg'
import {
  analysisFeatures,
  analysisScenarios,
  scenarioTests,
  users,
} from '@/lib/db/schema'
import { sql as sqlTag } from 'drizzle-orm'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { slugify } from '@/lib/auth/project-access'
import { seedEditableFromLatestAnalysis } from '@/lib/ai/analyze'
import { createFeatureSchema } from '@/lib/validators/analysis-edit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — retorna features (com cenários embutidos) da working copy editável.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  // Seed automático: se não há features mas existe análise antiga no jsonb,
  // popula as tabelas editáveis a partir dela. Ocorre no máximo uma vez.
  const featuresReviewer = alias(users, 'features_reviewer')
  let features = await db
    .select({
      feature: analysisFeatures,
      reviewerDisplay: featuresReviewer.displayName,
      reviewerEmail: featuresReviewer.email,
    })
    .from(analysisFeatures)
    .leftJoin(
      featuresReviewer,
      eq(featuresReviewer.id, analysisFeatures.reviewedBy),
    )
    .where(eq(analysisFeatures.projectId, project.id))
    .orderBy(asc(analysisFeatures.sortOrder))

  if (features.length === 0) {
    const seeded = await seedEditableFromLatestAnalysis(project.id)
    if (seeded) {
      features = await db
        .select({
          feature: analysisFeatures,
          reviewerDisplay: featuresReviewer.displayName,
          reviewerEmail: featuresReviewer.email,
        })
        .from(analysisFeatures)
        .leftJoin(
          featuresReviewer,
          eq(featuresReviewer.id, analysisFeatures.reviewedBy),
        )
        .where(eq(analysisFeatures.projectId, project.id))
        .orderBy(asc(analysisFeatures.sortOrder))
    }
  }

  const scenariosReviewer = alias(users, 'scenarios_reviewer')
  const scenarios = await db
    .select({
      scenario: analysisScenarios,
      reviewerDisplay: scenariosReviewer.displayName,
      reviewerEmail: scenariosReviewer.email,
    })
    .from(analysisScenarios)
    .leftJoin(
      scenariosReviewer,
      eq(scenariosReviewer.id, analysisScenarios.reviewedBy),
    )
    .where(eq(analysisScenarios.projectId, project.id))
    .orderBy(asc(analysisScenarios.sortOrder))

  // Teste mais recente por scenario (um join com subquery agrupada).
  // Usa scenario_id_snapshot pra pegar mesmo scenarios que já foram deletados.
  const latestTestsRaw = await db.execute<{
    scenario_id_snapshot: string
    id: string
    code: string
    test_run_id: string
    created_at: Date
  }>(sqlTag`
    SELECT DISTINCT ON (scenario_id_snapshot)
      scenario_id_snapshot, id, code, test_run_id, created_at
    FROM scenario_tests
    WHERE project_id = ${project.id}
    ORDER BY scenario_id_snapshot, created_at DESC
  `)
  const latestTestByScenario = new Map<
    string,
    {
      id: string
      code: string
      testRunId: string
      createdAt: string
    }
  >()
  for (const row of latestTestsRaw) {
    latestTestByScenario.set(row.scenario_id_snapshot, {
      id: row.id,
      code: row.code,
      testRunId: row.test_run_id,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    })
  }

  const scenariosByFeature = new Map<string, typeof scenarios>()
  for (const row of scenarios) {
    const arr = scenariosByFeature.get(row.scenario.featureId) ?? []
    arr.push(row)
    scenariosByFeature.set(row.scenario.featureId, arr)
  }

  return NextResponse.json(
    {
      features: features.map((row) => {
        const f = row.feature
        return {
          id: f.id,
          externalId: f.externalId,
          name: f.name,
          description: f.description,
          paths: f.paths,
          sortOrder: f.sortOrder,
          reviewedAt: f.reviewedAt,
          reviewedBy: f.reviewedBy
            ? {
                id: f.reviewedBy,
                displayName:
                  row.reviewerDisplay ?? row.reviewerEmail ?? 'Unknown',
              }
            : null,
          source: f.source,
          updatedAt: f.updatedAt,
          businessRule: f.businessRule,
          testRestrictions: f.testRestrictions,
          codeFocus: f.codeFocus,
          expectedEnvVars: f.expectedEnvVars,
          coveragePriorities: f.coveragePriorities,
          contextUpdatedAt: f.contextUpdatedAt,
          aiUnderstanding: f.aiUnderstanding,
          aiScenarios: f.aiScenarios,
          approvedAt: f.approvedAt,
          approvedBy: f.approvedBy,
          scenarios: (scenariosByFeature.get(f.id) ?? []).map((r) => {
            const s = r.scenario
            const latestTest = latestTestByScenario.get(s.id) ?? null
            return {
              id: s.id,
              title: s.title,
              rationale: s.rationale,
              priority: s.priority,
              preconditions: s.preconditions,
              dataNeeded: s.dataNeeded,
              sortOrder: s.sortOrder,
              reviewedAt: s.reviewedAt,
              reviewedBy: s.reviewedBy
                ? {
                    id: s.reviewedBy,
                    displayName:
                      r.reviewerDisplay ?? r.reviewerEmail ?? 'Unknown',
                  }
                : null,
              source: s.source,
              updatedAt: s.updatedAt,
              latestTest,
            }
          }),
        }
      }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * POST — cria feature manual.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const body = await req.json().catch(() => null)
  const parsed = createFeatureSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const [maxRow] = await db
    .select({ value: max(analysisFeatures.sortOrder) })
    .from(analysisFeatures)
    .where(eq(analysisFeatures.projectId, project.id))
  const nextOrder = (maxRow?.value ?? -1) + 1

  const [created] = await db
    .insert(analysisFeatures)
    .values({
      projectId: project.id,
      sourceAnalysisId: null,
      externalId: slugify(parsed.data.name),
      name: parsed.data.name,
      description: parsed.data.description,
      paths: parsed.data.paths,
      sortOrder: nextOrder,
      source: 'manual',
    })
    .returning()

  return NextResponse.json({ feature: created }, { status: 201 })
}
