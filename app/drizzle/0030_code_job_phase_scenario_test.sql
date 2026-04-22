-- Adiciona 'scenario_test' ao CHECK constraint de code_analysis_jobs.phase.
-- Substitui o constraint antigo (structure | tests) pela nova lista.

ALTER TABLE code_analysis_jobs
  DROP CONSTRAINT IF EXISTS code_analysis_jobs_phase_check;

ALTER TABLE code_analysis_jobs
  ADD CONSTRAINT code_analysis_jobs_phase_check
  CHECK (phase = ANY (ARRAY['structure'::text, 'tests'::text, 'scenario_test'::text]));
