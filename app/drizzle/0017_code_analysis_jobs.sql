-- Fila de jobs do container `codex`. Espelha crawl_jobs no padrão de
-- claim via FOR UPDATE SKIP LOCKED + heartbeat.

CREATE TABLE IF NOT EXISTS code_analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Snapshot da fonte no momento do disparo, pra job sobreviver a
  -- mudanças no projeto (ex.: QA troca a URL do repo depois).
  source_type TEXT NOT NULL,
  repo_url TEXT,
  repo_branch TEXT,
  repo_zip_path TEXT,
  requested_by UUID NOT NULL REFERENCES users(id),
  -- Heartbeat + lock otimista (worker_id + timestamp).
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  -- Métricas de custo do Claude Code.
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  turns_used INTEGER NOT NULL DEFAULT 0,
  -- Passos declarados pelo stream JSON do Claude Code (pra UI
  -- mostrar progresso em tempo real, igual crawler/runner).
  current_step_label TEXT,
  steps_completed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_analysis_jobs_status_chk
    CHECK (status IN ('pending','running','completed','failed','cancelled'))
);

CREATE INDEX IF NOT EXISTS code_analysis_jobs_project_idx
  ON code_analysis_jobs (project_id);

CREATE INDEX IF NOT EXISTS code_analysis_jobs_status_idx
  ON code_analysis_jobs (status);
