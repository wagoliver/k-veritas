import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  inet,
  real,
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
    targetLocale: text('target_locale').notNull().default('pt-BR'),
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

export const orgAiConfig = pgTable('org_ai_config', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  apiKeyEncrypted: bytea('api_key_encrypted'),
  temperature: real('temperature').notNull().default(0.3),
  numCtx: integer('num_ctx').notNull().default(16384),
  timeoutMs: integer('timeout_ms').notNull().default(300_000),
  updatedBy: uuid('updated_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const projectAnalyses = pgTable(
  'project_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    crawlId: uuid('crawl_id').references(() => crawlJobs.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('pending'),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    summary: text('summary'),
    inferredLocale: text('inferred_locale'),
    features: jsonb('features').notNull().default(sql`'[]'::jsonb`),
    rawResponse: text('raw_response'),
    error: text('error'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectIdx: index('project_analyses_project_idx').on(t.projectId),
    statusIdx: index('project_analyses_status_idx').on(t.status),
  }),
)

export const analysisFeatures = pgTable(
  'analysis_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceAnalysisId: uuid('source_analysis_id').references(
      () => projectAnalyses.id,
      { onDelete: 'set null' },
    ),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    paths: jsonb('paths').notNull().default(sql`'[]'::jsonb`),
    sortOrder: integer('sort_order').notNull().default(0),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    source: text('source').notNull().default('ai'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectIdx: index('analysis_features_project_idx').on(
      t.projectId,
      t.sortOrder,
    ),
    sourceIdx: index('analysis_features_source_analysis_idx').on(
      t.sourceAnalysisId,
    ),
  }),
)

export const analysisScenarios = pgTable(
  'analysis_scenarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    featureId: uuid('feature_id')
      .notNull()
      .references(() => analysisFeatures.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    priority: text('priority').notNull(),
    preconditions: jsonb('preconditions').notNull().default(sql`'[]'::jsonb`),
    dataNeeded: jsonb('data_needed').notNull().default(sql`'[]'::jsonb`),
    sortOrder: integer('sort_order').notNull().default(0),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    source: text('source').notNull().default('ai'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    featureIdx: index('analysis_scenarios_feature_idx').on(
      t.featureId,
      t.sortOrder,
    ),
    projectIdx: index('analysis_scenarios_project_idx').on(t.projectId),
  }),
)

export const projectTestRuns = pgTable(
  'project_test_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    scenariosIncludedCount: integer('scenarios_included_count')
      .notNull()
      .default(0),
    featuresCount: integer('features_count').notNull().default(0),
    filesCount: integer('files_count').notNull().default(0),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    rawResponse: text('raw_response'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectIdx: index('project_test_runs_project_idx').on(
      t.projectId,
      t.createdAt,
    ),
    statusIdx: index('project_test_runs_status_idx').on(t.status),
  }),
)

export const generatedTests = pgTable(
  'generated_tests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    testRunId: uuid('test_run_id')
      .notNull()
      .references(() => projectTestRuns.id, { onDelete: 'cascade' }),
    featureId: uuid('feature_id').references(() => analysisFeatures.id, {
      onDelete: 'set null',
    }),
    featureNameSnapshot: text('feature_name_snapshot').notNull(),
    filePath: text('file_path').notNull(),
    fileContent: text('file_content').notNull(),
    scenariosJson: jsonb('scenarios_json').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runIdx: index('generated_tests_run_idx').on(t.testRunId),
    projectIdx: index('generated_tests_project_idx').on(t.projectId),
  }),
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ProjectScenario = typeof projectScenarios.$inferSelect
export type ProjectTestRun = typeof projectTestRuns.$inferSelect
export type GeneratedTest = typeof generatedTests.$inferSelect
export type TestRunStatus = 'pending' | 'running' | 'completed' | 'failed'
export type CrawlJob = typeof crawlJobs.$inferSelect
export type CrawlPage = typeof crawlPages.$inferSelect
export type CrawlElement = typeof crawlElements.$inferSelect
export type ProjectAnalysis = typeof projectAnalyses.$inferSelect
export type AnalysisFeature = typeof analysisFeatures.$inferSelect
export type NewAnalysisFeature = typeof analysisFeatures.$inferInsert
export type AnalysisScenario = typeof analysisScenarios.$inferSelect
export type NewAnalysisScenario = typeof analysisScenarios.$inferInsert
export type AnalysisSource = 'ai' | 'manual'
export type ScenarioPriority = 'critical' | 'high' | 'normal' | 'low'
export type OrgAiConfig = typeof orgAiConfig.$inferSelect
export type NewOrgAiConfig = typeof orgAiConfig.$inferInsert
export type ProjectStatus = 'draft' | 'crawling' | 'ready' | 'failed'
export type AuthKind = 'none' | 'form'
export type AnalysisStatus = 'pending' | 'running' | 'completed' | 'failed'
export type AIProvider = 'ollama' | 'openai-compatible' | 'anthropic'
