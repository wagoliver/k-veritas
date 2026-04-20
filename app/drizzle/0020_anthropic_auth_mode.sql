-- Modo de autenticação da credencial Anthropic.
--
--   'api_key' (default): a chave cifrada em anthropic_api_key_encrypted
--                        é um ANTHROPIC_API_KEY (sk-ant-...). Codex roda
--                        `claude -p ... --bare` com esse env var.
--
--   'oauth':             a chave cifrada é um long-lived OAuth token
--                        gerado por `claude setup-token` na máquina do
--                        usuário. Codex roda `claude -p ...` (sem
--                        --bare) com CLAUDE_CODE_OAUTH_TOKEN. Usa a
--                        assinatura Claude Pro/Max, limites mais altos,
--                        tokens não cobrados por uso (dentro da quota).

ALTER TABLE org_ai_config
  ADD COLUMN IF NOT EXISTS anthropic_auth_mode TEXT NOT NULL DEFAULT 'api_key';

ALTER TABLE org_ai_config
  ADD CONSTRAINT org_ai_config_anthropic_auth_mode_chk
  CHECK (anthropic_auth_mode IN ('api_key', 'oauth'));
