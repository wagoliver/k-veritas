-- Planejamento de testes no nível do projeto. A QA preenche antes de
-- rodar o codex (tela Estrutura em modo draft):
--   test_scenarios: lista de cenários em linguagem livre (array de strings)
--   test_types:     tipos de teste desejados, marcáveis em checkbox
--                   (e2e, smoke, regression, integration)
--
-- Ambos jsonb com default vazio/e2e-apenas pra não quebrar projetos
-- existentes. O codex consome esses campos junto com business_context
-- no prompt da fase structure.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS test_scenarios JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS test_types JSONB NOT NULL DEFAULT '["e2e"]'::jsonb;
