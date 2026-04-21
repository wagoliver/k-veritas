-- Timeline detalhada de cada step top-level (pw:api) executado.
-- O runner acumula eventos do custom reporter durante a execução e
-- persiste em batch no fim do job. Usado pela UI para mostrar
-- duração, erro e linha no spec de cada passo.

CREATE TABLE IF NOT EXISTS "test_exec_step_events" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "result_id"      uuid NOT NULL REFERENCES "test_exec_results"("id") ON DELETE CASCADE,
  "step_index"     integer NOT NULL,
  "title"          text NOT NULL,
  "status"         text NOT NULL,        -- 'passed' | 'failed' | 'skipped'
  "duration_ms"    integer,
  "error_message"  text,
  "error_stack"    text,
  "line_in_spec"   integer,
  "started_at"     timestamptz NOT NULL,
  "finished_at"    timestamptz
);

CREATE INDEX IF NOT EXISTS test_exec_step_events_result_idx
  ON test_exec_step_events (result_id, step_index);
