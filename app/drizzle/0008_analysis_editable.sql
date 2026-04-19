-- Tabelas editáveis derivadas da análise IA. O jsonb em project_analyses.features
-- permanece como snapshot imutável do que o modelo gerou; essas tabelas são a
-- "working copy" que o humano edita e que a Fase 2.3 (Playwright) consumirá.

CREATE TABLE IF NOT EXISTS "analysis_features" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"          uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "source_analysis_id"  uuid REFERENCES "project_analyses"("id") ON DELETE SET NULL,
  "external_id"         text NOT NULL,        -- slug gerado pelo LLM (ex.: "dashboard-and-analytics")
  "name"                text NOT NULL,
  "description"         text NOT NULL,
  "paths"               jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sort_order"          integer NOT NULL DEFAULT 0,
  "reviewed_at"         timestamptz,
  "source"              text NOT NULL DEFAULT 'ai',   -- 'ai' | 'manual'
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analysis_features_project_idx
  ON analysis_features (project_id, sort_order);
CREATE INDEX IF NOT EXISTS analysis_features_source_analysis_idx
  ON analysis_features (source_analysis_id);

CREATE TABLE IF NOT EXISTS "analysis_scenarios" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "feature_id"          uuid NOT NULL REFERENCES "analysis_features"("id") ON DELETE CASCADE,
  "project_id"          uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "title"               text NOT NULL,
  "rationale"           text NOT NULL,
  "priority"            text NOT NULL,                -- critical | high | normal | low
  "preconditions"       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "data_needed"         jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sort_order"          integer NOT NULL DEFAULT 0,
  "reviewed_at"         timestamptz,
  "source"              text NOT NULL DEFAULT 'ai',
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analysis_scenarios_feature_idx
  ON analysis_scenarios (feature_id, sort_order);
CREATE INDEX IF NOT EXISTS analysis_scenarios_project_idx
  ON analysis_scenarios (project_id);
