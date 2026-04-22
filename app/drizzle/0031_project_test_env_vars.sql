-- Variáveis de ambiente por projeto pros testes Playwright gerados.
-- A QA preenche essa lista na aba Setup; o runner injeta essas vars no
-- env do processo filho do Playwright antes de rodar o .spec.ts.
--
-- O valor é cifrado simetricamente pela mesma rotina que cifra credenciais
-- Anthropic / form auth (bytea). Nome em UPPER_SNAKE_CASE enforceado no
-- validator da API; no banco só garantimos NOT NULL e unicidade por projeto.
--
-- Detecção de variáveis novas é dinâmica: o endpoint GET varre
-- feature_ai_scenario_tests.code por `process.env.<NOME>` e faz merge com
-- o que está aqui — QA vê imediatamente as vars que os testes novos
-- precisam mesmo sem tê-las pré-cadastrado.

CREATE TABLE IF NOT EXISTS project_test_env_vars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value_encrypted BYTEA NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS project_test_env_vars_project_idx
  ON project_test_env_vars (project_id);
