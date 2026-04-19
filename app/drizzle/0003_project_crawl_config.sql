-- Configurações de crawl por projeto

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "crawl_max_depth" integer NOT NULL DEFAULT 3;
