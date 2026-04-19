-- Audit de revisão: quem marcou o item como revisado.
-- ON DELETE SET NULL porque se o usuário for apagado, o estado "revisado"
-- continua válido — só perde a atribuição. O histórico completo fica no
-- ClickHouse (analysis_review_events).

ALTER TABLE "analysis_features"
  ADD COLUMN IF NOT EXISTS "reviewed_by" uuid
  REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "analysis_scenarios"
  ADD COLUMN IF NOT EXISTS "reviewed_by" uuid
  REFERENCES "users"("id") ON DELETE SET NULL;
