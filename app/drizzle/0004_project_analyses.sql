-- Análises geradas pela IA a partir do crawl

CREATE TABLE IF NOT EXISTS "project_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "crawl_id" uuid REFERENCES "crawl_jobs"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "model" text NOT NULL,
  "provider" text NOT NULL,
  "summary" text,
  "inferred_locale" text,
  "features" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "raw_response" text,
  "error" text,
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "tokens_in" integer,
  "tokens_out" integer,
  "duration_ms" integer,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "project_analyses_project_idx" ON "project_analyses"("project_id");
CREATE INDEX IF NOT EXISTS "project_analyses_status_idx" ON "project_analyses"("status");
