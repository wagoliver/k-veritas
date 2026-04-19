-- Multi-tenant foundation: orgs + membership
-- UI hides the switcher while a user has only 1 org (Personal).

CREATE TABLE IF NOT EXISTS "orgs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "orgs_slug_unique" ON "orgs" ("slug");
CREATE INDEX IF NOT EXISTS "orgs_owner_idx" ON "orgs" ("owner_user_id");

CREATE TABLE IF NOT EXISTS "org_members" (
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'member',
  "joined_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("org_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "org_members_user_idx" ON "org_members" ("user_id");
