-- Suporte a re-crawl de path único + adição manual de paths
-- scope='full' (default): BFS normal a partir de target_url
-- scope='single_path': visita só scope_url e upsert em crawl_pages do último crawl completed

ALTER TABLE "crawl_jobs"
  ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS "scope_url" text;

-- Único path por crawl_id evita duplicação quando single_path re-roda várias vezes.
-- (O crawler já trata como upsert; esse índice protege corrida.)
CREATE UNIQUE INDEX IF NOT EXISTS "crawl_pages_crawl_url_unique"
  ON "crawl_pages" ("crawl_id", "url");
