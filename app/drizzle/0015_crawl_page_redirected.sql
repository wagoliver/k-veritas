-- Marcar quando uma page foi redirecionada pelo site alvo (comum em rotas
-- públicas de auth como /register quando o crawler está logado).
-- Quando redirected_to != NULL, NÃO houve extração de elementos — o DOM
-- da URL final não representa a URL solicitada.

ALTER TABLE "crawl_pages"
  ADD COLUMN IF NOT EXISTS "redirected_to" text;
