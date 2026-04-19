-- Projects, scenarios and crawl artifacts

CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "target_url" text NOT NULL,
  "description" text,
  "auth_kind" text NOT NULL DEFAULT 'none',
  "auth_credentials" bytea,
  "ingestion_mode" text NOT NULL DEFAULT 'sample',
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "projects_org_slug_unique" ON "projects" ("org_id", "slug");
CREATE INDEX IF NOT EXISTS "projects_org_idx" ON "projects" ("org_id");

CREATE TABLE IF NOT EXISTS "project_scenarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "priority" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "project_scenarios_project_idx" ON "project_scenarios" ("project_id");

CREATE TABLE IF NOT EXISTS "crawl_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending',
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "pages_count" integer NOT NULL DEFAULT 0,
  "error" text,
  "locked_by" text,
  "locked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "crawl_jobs_pending_idx" ON "crawl_jobs" ("status", "created_at")
  WHERE "status" IN ('pending','running');
CREATE INDEX IF NOT EXISTS "crawl_jobs_project_idx" ON "crawl_jobs" ("project_id");

CREATE TABLE IF NOT EXISTS "crawl_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "crawl_id" uuid NOT NULL REFERENCES "crawl_jobs"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "title" text,
  "status_code" integer,
  "screenshot_path" text,
  "dom_path" text,
  "discovered_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "crawl_pages_crawl_idx" ON "crawl_pages" ("crawl_id");

CREATE TABLE IF NOT EXISTS "crawl_elements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "page_id" uuid NOT NULL REFERENCES "crawl_pages"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "role" text,
  "label" text,
  "selector" text NOT NULL,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS "crawl_elements_page_idx" ON "crawl_elements" ("page_id");
CREATE INDEX IF NOT EXISTS "crawl_elements_kind_idx" ON "crawl_elements" ("kind");
