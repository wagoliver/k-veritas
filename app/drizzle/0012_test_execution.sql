-- Fase 3.a: execução de testes Playwright dentro da plataforma.
-- Padrão idêntico aos crawl_jobs: fila no Postgres + worker polling.

CREATE TABLE IF NOT EXISTS "test_exec_runs" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"        uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "scope"             text NOT NULL,                    -- 'scenario' | 'feature' | 'project'
  "scope_id"          uuid,                             -- scenario_id quando scope='scenario'
  "status"            text NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed
  "requested_by"      uuid NOT NULL REFERENCES "users"("id"),
  "locked_by"         text,
  "locked_at"         timestamptz,
  "started_at"        timestamptz,
  "finished_at"       timestamptz,
  "error"             text,
  "scenarios_count"   integer NOT NULL DEFAULT 0,
  "passed_count"      integer NOT NULL DEFAULT 0,
  "failed_count"      integer NOT NULL DEFAULT 0,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_exec_runs_project_idx
  ON test_exec_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS test_exec_runs_pending_idx
  ON test_exec_runs (status, created_at)
  WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS "test_exec_results" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id"             uuid NOT NULL REFERENCES "test_exec_runs"("id") ON DELETE CASCADE,
  "project_id"         uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "scenario_id"        uuid REFERENCES "analysis_scenarios"("id") ON DELETE SET NULL,
  "scenario_id_snapshot" uuid NOT NULL,
  "title_snapshot"     text NOT NULL,
  "status"             text NOT NULL,        -- 'passed' | 'failed' | 'skipped' | 'timedout'
  "duration_ms"        integer,
  "error_message"      text,
  "error_stack"        text,
  "trace_path"         text,                 -- relativo a /data
  "screenshot_path"    text,
  "stdout"             text,
  "created_at"         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_exec_results_run_idx
  ON test_exec_results (run_id);
CREATE INDEX IF NOT EXISTS test_exec_results_scenario_idx
  ON test_exec_results (project_id, scenario_id_snapshot, created_at DESC);
