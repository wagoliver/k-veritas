import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  inet,
  customType,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core'

const citext = customType<{ data: string }>({
  dataType: () => 'citext',
})

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name'),
    locale: text('locale').notNull().default('pt-BR'),
    status: text('status').notNull().default('active'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex('users_email_unique').on(t.email),
  }),
)

export const mfaFactors = pgTable('mfa_factors', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('totp'),
  secretEncrypted: bytea('secret_encrypted').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshHash: bytea('refresh_hash').notNull(),
    userAgent: text('user_agent'),
    ipInet: inet('ip_inet'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: uuid('replaced_by'),
    mfaLevel: text('mfa_level').notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    refreshHashUnique: uniqueIndex('sessions_refresh_hash_unique').on(
      t.refreshHash,
    ),
    userIdx: index('sessions_user_idx').on(t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
  }),
)

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenUnique: uniqueIndex('password_reset_tokens_hash_unique').on(
      t.tokenHash,
    ),
    expiresIdx: index('password_reset_tokens_expires_idx').on(t.expiresAt),
  }),
)

export const mfaChallenges = pgTable('mfa_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  ipInet: inet('ip_inet'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  tokens: integer('tokens').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    event: text('event').notNull(),
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
    ipInet: inet('ip_inet'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('audit_log_user_idx').on(t.userId),
    eventIdx: index('audit_log_event_idx').on(t.event),
    createdIdx: index('audit_log_created_idx').on(t.createdAt),
  }),
)

export const orgs = pgTable(
  'orgs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex('orgs_slug_unique').on(t.slug),
    ownerIdx: index('orgs_owner_idx').on(t.ownerUserId),
  }),
)

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
    userIdx: index('org_members_user_idx').on(t.userId),
  }),
)

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    targetUrl: text('target_url').notNull(),
    description: text('description'),
    authKind: text('auth_kind').notNull().default('none'),
    authCredentials: bytea('auth_credentials'),
    ingestionMode: text('ingestion_mode').notNull().default('sample'),
    crawlMaxDepth: integer('crawl_max_depth').notNull().default(3),
    status: text('status').notNull().default('draft'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgSlugUnique: uniqueIndex('projects_org_slug_unique').on(t.orgId, t.slug),
    orgIdx: index('projects_org_idx').on(t.orgId),
  }),
)

export const projectScenarios = pgTable(
  'project_scenarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectIdx: index('project_scenarios_project_idx').on(t.projectId),
  }),
)

export const crawlJobs = pgTable(
  'crawl_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    pagesCount: integer('pages_count').notNull().default(0),
    error: text('error'),
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectIdx: index('crawl_jobs_project_idx').on(t.projectId),
  }),
)

export const crawlPages = pgTable(
  'crawl_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    crawlId: uuid('crawl_id')
      .notNull()
      .references(() => crawlJobs.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    title: text('title'),
    statusCode: integer('status_code'),
    screenshotPath: text('screenshot_path'),
    domPath: text('dom_path'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    crawlIdx: index('crawl_pages_crawl_idx').on(t.crawlId),
  }),
)

export const crawlElements = pgTable(
  'crawl_elements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => crawlPages.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    role: text('role'),
    label: text('label'),
    selector: text('selector').notNull(),
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    pageIdx: index('crawl_elements_page_idx').on(t.pageId),
    kindIdx: index('crawl_elements_kind_idx').on(t.kind),
  }),
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type MfaFactor = typeof mfaFactors.$inferSelect
export type Org = typeof orgs.$inferSelect
export type OrgMember = typeof orgMembers.$inferSelect
export type OrgRole = 'owner' | 'admin' | 'editor' | 'member' | 'viewer'
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ProjectScenario = typeof projectScenarios.$inferSelect
export type CrawlJob = typeof crawlJobs.$inferSelect
export type CrawlPage = typeof crawlPages.$inferSelect
export type CrawlElement = typeof crawlElements.$inferSelect
export type ProjectStatus = 'draft' | 'crawling' | 'ready' | 'failed'
export type AuthKind = 'none' | 'form'
