-- Testes Playwright gerados pela IA a partir dos `aiScenarios` aprovados.
-- Um registro por cenário (UNIQUE feature_id + scenario_id). Regenerar
-- sobrescreve via ON CONFLICT DO UPDATE no endpoint.
--
-- scenario_id é TEXT (UUID stringificado) porque os cenários vivem como
-- objetos dentro de `analysis_features.ai_scenarios` (jsonb), sem FK
-- relacional direta. O ID estável é gerado server-side no import do codex
-- e preservado em edições via PATCH.

CREATE TABLE IF NOT EXISTS feature_ai_scenario_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES analysis_features(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL,
  code TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (feature_id, scenario_id)
);

CREATE INDEX IF NOT EXISTS feature_ai_scenario_tests_project_idx
  ON feature_ai_scenario_tests (project_id);
CREATE INDEX IF NOT EXISTS feature_ai_scenario_tests_feature_idx
  ON feature_ai_scenario_tests (feature_id);
