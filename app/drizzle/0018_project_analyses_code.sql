-- project_analyses passa a comportar duas origens: 'crawl' (fluxo
-- original, crawler Playwright) e 'code' (fluxo novo, Claude Code).
-- O resto do schema (features/scenarios) é agnóstico — a UI existente
-- reusa sem mudança.

ALTER TABLE project_analyses
  ADD COLUMN IF NOT EXISTS analysis_type TEXT NOT NULL DEFAULT 'crawl';

ALTER TABLE project_analyses
  ADD CONSTRAINT project_analyses_type_chk
  CHECK (analysis_type IN ('crawl', 'code'));

ALTER TABLE project_analyses
  ADD COLUMN IF NOT EXISTS code_analysis_job_id UUID
  REFERENCES code_analysis_jobs(id) ON DELETE SET NULL;

-- Caminho relativo ao /data do manifest.json escrito pelo Claude Code.
-- Guardamos pra poder re-importar/auditar sem precisar rodar o job
-- de novo.
ALTER TABLE project_analyses
  ADD COLUMN IF NOT EXISTS manifest_path TEXT;

-- Invariante: análise 'code' deve vir de um job de código;
-- análise 'crawl' não deve ter job de código. O inverso (crawl_id)
-- fica opcional pra análises 'crawl' antigas que já existem.
ALTER TABLE project_analyses
  ADD CONSTRAINT project_analyses_code_ref_chk
  CHECK (
    (analysis_type = 'crawl' AND code_analysis_job_id IS NULL)
    OR
    (analysis_type = 'code' AND code_analysis_job_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS project_analyses_code_job_idx
  ON project_analyses (code_analysis_job_id);
