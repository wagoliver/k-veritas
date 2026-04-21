-- Override de modelo por job da análise de código. Quando presente,
-- o codex usa ele em vez do anthropic_model da org (ou CODEX_MODEL env).
-- NULL = usa o default resolvido.

ALTER TABLE "code_analysis_jobs"
  ADD COLUMN IF NOT EXISTS "model_override" TEXT;
