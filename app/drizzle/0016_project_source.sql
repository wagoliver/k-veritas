-- Code-first support: projects ganham fonte (url | repo) e contexto de negócio
-- que alimenta o prompt do Claude Code CLI em container.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'url';

ALTER TABLE projects
  ADD CONSTRAINT projects_source_type_chk
  CHECK (source_type IN ('url', 'repo'));

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS repo_url TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS repo_branch TEXT NOT NULL DEFAULT 'main';

-- Caminho relativo ao volume `/data` quando a fonte é um ZIP.
-- Formato: projects/<projectId>/source.zip
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS repo_zip_path TEXT;

-- Texto markdown escrito pela QA descrevendo casos de uso e regras
-- de negócio. Passado ao Claude Code como /work/<jobId>/context.md.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS business_context TEXT;

-- Exige que projetos do tipo 'repo' tenham uma fonte resolvida
-- (URL ou ZIP). Projetos 'url' continuam com targetUrl obrigatório
-- (constraint já existente no tipo da coluna).
ALTER TABLE projects
  ADD CONSTRAINT projects_repo_source_chk
  CHECK (
    source_type <> 'repo'
    OR (repo_url IS NOT NULL OR repo_zip_path IS NOT NULL)
  );
