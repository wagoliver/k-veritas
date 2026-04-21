-- Discovery code-first em 2 etapas:
--   fase 'structure' = IA mapeia só estrutura e propõe features (barato)
--   fase 'tests'     = IA gera testes de uma feature específica com
--                      contexto preenchido pela QA (caro, escopado)
--
-- Features ganham campos de contexto por-feature que a QA preenche
-- entre as duas etapas. Todos opcionais — quando vazios, comportamento
-- atual persiste.

ALTER TABLE "code_analysis_jobs"
  ADD COLUMN IF NOT EXISTS "phase" TEXT NOT NULL DEFAULT 'structure'
    CHECK ("phase" IN ('structure','tests')),
  ADD COLUMN IF NOT EXISTS "target_feature_id" UUID
    REFERENCES "analysis_features"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS code_analysis_jobs_phase_status_idx
  ON "code_analysis_jobs" ("phase", "status");

ALTER TABLE "analysis_features"
  ADD COLUMN IF NOT EXISTS "business_rule" TEXT,
  ADD COLUMN IF NOT EXISTS "test_restrictions" TEXT,
  ADD COLUMN IF NOT EXISTS "code_focus" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "expected_env_vars" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "coverage_priorities" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "context_updated_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "context_updated_by" UUID
    REFERENCES "users"("id") ON DELETE SET NULL;

-- Cenários livres da QA escopados a uma feature (variante code-first).
-- project_scenarios continua global, usado pelo fluxo crawler.
CREATE TABLE IF NOT EXISTS "feature_free_scenarios" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"  UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "feature_id"  UUID NOT NULL REFERENCES "analysis_features"("id") ON DELETE CASCADE,
  "description" TEXT NOT NULL,
  "priority"    INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feature_free_scenarios_feature_idx
  ON "feature_free_scenarios" ("feature_id", "created_at");

CREATE INDEX IF NOT EXISTS feature_free_scenarios_project_idx
  ON "feature_free_scenarios" ("project_id");
