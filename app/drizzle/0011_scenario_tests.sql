-- Refactor da Fase 2.3: teste passa a ser propriedade do SCENARIO, não
-- um arquivo isolado. Cada rodada (project_test_runs) gera N snippets,
-- um por scenario. O arquivo .spec.ts é reconstruído no download
-- concatenando os snippets de scenarios da mesma feature.

CREATE TABLE IF NOT EXISTS "scenario_tests" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"       uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "test_run_id"      uuid NOT NULL REFERENCES "project_test_runs"("id") ON DELETE CASCADE,
  "scenario_id"      uuid REFERENCES "analysis_scenarios"("id") ON DELETE SET NULL,
  "scenario_id_snapshot" uuid NOT NULL,         -- preserva o id mesmo se scenario for deletado
  "feature_id"       uuid REFERENCES "analysis_features"("id") ON DELETE SET NULL,
  "feature_name_snapshot"  text NOT NULL,
  "feature_external_id_snapshot" text NOT NULL, -- slug da feature (pra reagrupar no download)
  "file_path"        text NOT NULL,             -- caminho relativo, ex.: financeiro/dashboard.spec.ts
  "code"             text NOT NULL,             -- somente o bloco test(...) { ... }
  "title_snapshot"   text NOT NULL,             -- título do scenario no momento da geração
  "created_at"       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenario_tests_run_idx
  ON scenario_tests (test_run_id);
CREATE INDEX IF NOT EXISTS scenario_tests_scenario_idx
  ON scenario_tests (scenario_id);
CREATE INDEX IF NOT EXISTS scenario_tests_project_scenario_idx
  ON scenario_tests (project_id, scenario_id_snapshot, created_at DESC);

-- Header/footer por feature por run — permite reconstruir o arquivo
-- completo no download sem depender do LLM enviar mesmo header N vezes.
CREATE TABLE IF NOT EXISTS "feature_test_files" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"             uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "test_run_id"            uuid NOT NULL REFERENCES "project_test_runs"("id") ON DELETE CASCADE,
  "feature_id"             uuid REFERENCES "analysis_features"("id") ON DELETE SET NULL,
  "feature_external_id_snapshot" text NOT NULL,
  "feature_name_snapshot"  text NOT NULL,
  "file_path"              text NOT NULL,
  "file_header"            text NOT NULL,       -- imports + test.describe open
  "file_footer"            text NOT NULL,       -- } fechamento do describe
  "created_at"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feature_test_files_run_idx
  ON feature_test_files (test_run_id);

-- `generated_tests` vira depreciada — não apagamos ainda pra preservar
-- eventuais runs antigos. Futura migration 0012 pode dropar quando a
-- tela confirmar que não lê mais dela.
