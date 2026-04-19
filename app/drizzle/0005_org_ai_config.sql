-- Configuração de IA por organização.
-- Uma config ativa por org. Fallback para env vars quando não configurado.

CREATE TABLE IF NOT EXISTS "org_ai_config" (
  "org_id" uuid PRIMARY KEY REFERENCES "orgs"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,              -- 'ollama' | 'openai-compatible'
  "base_url" text NOT NULL,
  "model" text NOT NULL,
  "api_key_encrypted" bytea,             -- opcional (cloud); cifrado AES-GCM
  "temperature" real NOT NULL DEFAULT 0.3,
  "num_ctx" integer NOT NULL DEFAULT 16384,
  "timeout_ms" integer NOT NULL DEFAULT 300000,
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
