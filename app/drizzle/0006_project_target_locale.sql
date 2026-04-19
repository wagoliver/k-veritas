-- Locale-alvo por projeto: define em que idioma a IA deve gerar
-- summary, features, cenários, etc. Default 'pt-BR' para retrocompatibilidade.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "target_locale" text NOT NULL DEFAULT 'pt-BR';
