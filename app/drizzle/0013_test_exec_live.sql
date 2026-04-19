-- Acompanhamento em tempo real: runner escreve o step atual conforme
-- os eventos chegam do custom reporter do Playwright. UI faz polling e
-- mostra qual step está sendo executado agora.

ALTER TABLE "test_exec_runs"
  ADD COLUMN IF NOT EXISTS "current_step_label" text,
  ADD COLUMN IF NOT EXISTS "current_step_line" integer,
  ADD COLUMN IF NOT EXISTS "steps_completed" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "steps_total" integer NOT NULL DEFAULT 0;
