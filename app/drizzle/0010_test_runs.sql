-- Fase 2.3: geração de código Playwright a partir de cenários revisados.
-- Uma "test run" é uma rodada de geração; produz N arquivos .spec.ts.

CREATE TABLE IF NOT EXISTS "project_test_runs" (
  "id"                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"                 uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "status"                     text NOT NULL DEFAULT 'pending',   -- pending | running | completed | failed
  "provider"                   text NOT NULL,
  "model"                      text NOT NULL,
  "requested_by"               uuid NOT NULL REFERENCES "users"("id"),
  "scenarios_included_count"   integer NOT NULL DEFAULT 0,
  "features_count"             integer NOT NULL DEFAULT 0,
  "files_count"                integer NOT NULL DEFAULT 0,
  "tokens_in"                  integer,
  "tokens_out"                 integer,
  "duration_ms"                integer,
  "error"                      text,
  "raw_response"               text,
  "started_at"                 timestamptz,
  "finished_at"                timestamptz,
  "created_at"                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_test_runs_project_idx
  ON project_test_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_test_runs_status_idx
  ON project_test_runs (status);

CREATE TABLE IF NOT EXISTS "generated_tests" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"           uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "test_run_id"          uuid NOT NULL REFERENCES "project_test_runs"("id") ON DELETE CASCADE,
  "feature_id"           uuid REFERENCES "analysis_features"("id") ON DELETE SET NULL,
  "feature_name_snapshot" text NOT NULL,
  "file_path"            text NOT NULL,       -- relativo, ex.: checkout/login.spec.ts
  "file_content"         text NOT NULL,       -- código .spec.ts completo
  "scenarios_json"       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- snapshot dos cenários usados
  "created_at"           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generated_tests_run_idx
  ON generated_tests (test_run_id);
CREATE INDEX IF NOT EXISTS generated_tests_project_idx
  ON generated_tests (project_id);
