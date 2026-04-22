-- Refatoração "Contexto da feature": a QA deixa de preencher forms
-- campo-a-campo e passa a revisar um TEXTO que a IA escreveu sobre
-- cada feature durante a fase 'structure' do codex. Aprovação por
-- card libera a feature pra próxima fase (Cenário).
--
-- Campos antigos de contexto (business_rule, test_restrictions,
-- code_focus, expected_env_vars, coverage_priorities) ficam no schema
-- sem uso — serão removidos em iteração futura quando a tela Cenário
-- estabilizar. Assim evita-se migração destrutiva enquanto o modelo
-- ainda pode evoluir.

ALTER TABLE analysis_features
  ADD COLUMN IF NOT EXISTS ai_understanding TEXT;

ALTER TABLE analysis_features
  ADD COLUMN IF NOT EXISTS ai_scenarios JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE analysis_features
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE analysis_features
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS analysis_features_approved_idx
  ON analysis_features (project_id, approved_at);
