import 'server-only'
import { eq, sql } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'

import { db } from '@/lib/db/pg'
import { analysisFeatures, analysisScenarios } from '@/lib/db/schema'

type Executor = typeof db | PgTransaction<any, any, any>

/**
 * Recomputa o estado "reviewed" de uma feature baseado nos scenarios
 * dentro dela.
 *
 * Regra: feature é considerada revisada IFF tem ≥1 scenario E todos os
 * scenarios estão revisados. Qualquer outro caso desmarca.
 *
 * O `userId` é usado como `reviewed_by` quando a recomputação marca a
 * feature como revisada (cascade a partir da última ação do usuário). Se
 * desmarca, `reviewed_by` vira null.
 *
 * Chamar após qualquer mutação em analysis_scenarios que afete este
 * feature_id: PATCH (reviewed/move), POST, DELETE, e populate em analyze.ts.
 */
export async function recomputeFeatureReviewed(
  featureId: string,
  userId: string | null,
  executor: Executor = db,
): Promise<void> {
  const [stats] = await executor
    .select({
      total: sql<number>`count(*)::int`,
      reviewed: sql<number>`count(*) filter (where ${analysisScenarios.reviewedAt} is not null)::int`,
    })
    .from(analysisScenarios)
    .where(eq(analysisScenarios.featureId, featureId))

  if (!stats) return

  const allReviewed = stats.total > 0 && stats.reviewed === stats.total

  await executor
    .update(analysisFeatures)
    .set({
      reviewedAt: allReviewed ? new Date() : null,
      reviewedBy: allReviewed ? userId : null,
      updatedAt: new Date(),
    })
    .where(eq(analysisFeatures.id, featureId))
}
