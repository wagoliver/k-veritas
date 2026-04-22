-- Geração de testes Playwright por cenário agora roda no kveritas-codex
-- (Claude Code CLI com tools reais), não mais via chamada LLM direta da
-- API. Pra isso o job precisa identificar o cenário específico dentro do
-- aiScenarios da feature.
--
-- phase='scenario_test' indica esse novo tipo de job:
--   - target_feature_id: feature dona do cenário
--   - target_scenario_id: UUID do cenário (string no jsonb aiScenarios)
--
-- scenario_id é TEXT porque o cenário não tem FK relacional — vive como
-- objeto dentro de analysis_features.ai_scenarios (jsonb).

ALTER TABLE code_analysis_jobs
  ADD COLUMN IF NOT EXISTS target_scenario_id TEXT;
