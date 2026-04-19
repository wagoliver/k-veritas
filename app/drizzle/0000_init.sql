-- k-veritas initial schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" citext NOT NULL,
  "email_verified_at" timestamptz,
  "password_hash" text NOT NULL,
  "display_name" text,
  "locale" text NOT NULL DEFAULT 'pt-BR',
  "status" text NOT NULL DEFAULT 'active',
  "failed_login_count" integer NOT NULL DEFAULT 0,
  "locked_until" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" ("email");

CREATE TABLE IF NOT EXISTS "mfa_factors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "type" text NOT NULL DEFAULT 'totp',
  "secret_encrypted" bytea NOT NULL,
  "confirmed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "refresh_hash" bytea NOT NULL,
  "user_agent" text,
  "ip_inet" inet,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "replaced_by" uuid,
  "mfa_level" text NOT NULL DEFAULT 'none',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_refresh_hash_unique" ON "sessions" ("refresh_hash");
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" ("expires_at");

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "token_hash" bytea NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_hash_unique" ON "password_reset_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_expires_idx" ON "password_reset_tokens" ("expires_at");

CREATE TABLE IF NOT EXISTS "mfa_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "attempts" integer NOT NULL DEFAULT 0,
  "ip_inet" inet,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key" text PRIMARY KEY,
  "tokens" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "event" text NOT NULL,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip_inet" inet,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_log_user_idx" ON "audit_log" ("user_id");
CREATE INDEX IF NOT EXISTS "audit_log_event_idx" ON "audit_log" ("event");
CREATE INDEX IF NOT EXISTS "audit_log_created_idx" ON "audit_log" ("created_at");
