-- Credencial Anthropic dedicada à análise de código (Claude Code CLI).
--
-- org_ai_config já tem api_key_encrypted para o provider principal
-- (Ollama / OpenAI-compatible / Anthropic). Como a feature de análise
-- de código-fonte usa o CLI oficial do Claude Code — que é Anthropic-
-- only — precisamos de uma credencial separada quando a org escolheu
-- outro provider pro fluxo original (análise sobre crawler).
--
-- Regra de leitura no codex:
--   1. se anthropic_api_key_encrypted tiver valor, usa ela
--   2. senão, se provider = 'anthropic', usa api_key_encrypted (reuso)
--   3. senão, a feature fica desabilitada pra essa org.

ALTER TABLE org_ai_config
  ADD COLUMN IF NOT EXISTS anthropic_api_key_encrypted BYTEA;

ALTER TABLE org_ai_config
  ADD COLUMN IF NOT EXISTS anthropic_model TEXT;
