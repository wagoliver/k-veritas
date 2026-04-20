import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  codeAnalysisJobs,
  orgAiConfig,
  projects,
} from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'
import { authorizeProject } from '@/lib/auth/project-access'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const items = await db
    .select({
      id: codeAnalysisJobs.id,
      status: codeAnalysisJobs.status,
      tokensIn: codeAnalysisJobs.tokensIn,
      tokensOut: codeAnalysisJobs.tokensOut,
      turnsUsed: codeAnalysisJobs.turnsUsed,
      stepsCompleted: codeAnalysisJobs.stepsCompleted,
      currentStepLabel: codeAnalysisJobs.currentStepLabel,
      error: codeAnalysisJobs.error,
      startedAt: codeAnalysisJobs.startedAt,
      finishedAt: codeAnalysisJobs.finishedAt,
      createdAt: codeAnalysisJobs.createdAt,
    })
    .from(codeAnalysisJobs)
    .where(eq(codeAnalysisJobs.projectId, project.id))
    .orderBy(desc(codeAnalysisJobs.createdAt))
    .limit(20)

  return NextResponse.json({ items })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  // Só faz sentido disparar code-analysis em projetos com source_type='repo'.
  if (project.sourceType !== 'repo') {
    return Problems.invalidBody({ source: 'source_not_configured' })
  }
  const hasSource = project.repoUrl !== null || project.repoZipPath !== null
  if (!hasSource) {
    return Problems.invalidBody({ source: 'source_not_configured' })
  }

  const rl = await consumeToken(BUCKETS.codeAnalyzeProject(project.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  // Pre-check da credencial Anthropic. Falha fast aqui com mensagem
  // acionável em vez de deixar o codex descobrir só quando pegar o job.
  // Mesma regra do codex/src/db.ts#resolveAnthropic:
  //   1. chave dedicada (anthropic_api_key_encrypted)
  //   2. se não há, chave do provider principal quando provider=anthropic
  //   3. senão, feature desabilitada
  const [aiCfg] = await db
    .select({
      provider: orgAiConfig.provider,
      apiKeyEncrypted: orgAiConfig.apiKeyEncrypted,
      anthropicApiKeyEncrypted: orgAiConfig.anthropicApiKeyEncrypted,
    })
    .from(orgAiConfig)
    .where(eq(orgAiConfig.orgId, project.orgId))
    .limit(1)

  const hasAnthropic =
    Boolean(aiCfg?.anthropicApiKeyEncrypted) ||
    (aiCfg?.provider === 'anthropic' && Boolean(aiCfg?.apiKeyEncrypted))
  if (!hasAnthropic) {
    return Problems.invalidBody({ anthropicKey: 'anthropic_key_missing' })
  }

  // Evita dois jobs simultâneos no mesmo projeto.
  const [running] = await db
    .select({ id: codeAnalysisJobs.id })
    .from(codeAnalysisJobs)
    .where(
      and(
        eq(codeAnalysisJobs.projectId, project.id),
        inArray(codeAnalysisJobs.status, ['pending', 'running']),
      ),
    )
    .limit(1)
  if (running) {
    return Problems.conflict(
      'code_analysis_running',
      'Já existe uma análise de código em andamento para este projeto.',
    )
  }

  const [job] = await db
    .insert(codeAnalysisJobs)
    .values({
      projectId: project.id,
      requestedBy: session.user.id,
      sourceType: 'repo',
      repoUrl: project.repoUrl,
      repoBranch: project.repoBranch,
      repoZipPath: project.repoZipPath,
      status: 'pending',
    })
    .returning({ id: codeAnalysisJobs.id })
  if (!job) return Problems.server()

  await db
    .update(projects)
    .set({ status: 'crawling', updatedAt: new Date() })
    .where(eq(projects.id, project.id))

  await audit({
    userId: session.user.id,
    event: 'code_analysis_requested',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { projectId: project.id, jobId: job.id },
    outcome: 'success',
  })

  return NextResponse.json(
    { id: job.id, status: 'pending' },
    { status: 202 },
  )
}
