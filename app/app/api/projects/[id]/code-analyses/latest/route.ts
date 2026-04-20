import { NextResponse, type NextRequest } from 'next/server'
import { desc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { codeAnalysisJobs } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'

// Endpoint de leitura usado pelo CodeAnalysisPanel. Retorna o último job
// de análise de código + o subset da config do projeto que a tela precisa
// (source_type, repo_url, repo_branch, flag se tem business_context).
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const [latest] = await db
    .select({
      id: codeAnalysisJobs.id,
      status: codeAnalysisJobs.status,
      sourceType: codeAnalysisJobs.sourceType,
      repoUrl: codeAnalysisJobs.repoUrl,
      repoBranch: codeAnalysisJobs.repoBranch,
      currentStepLabel: codeAnalysisJobs.currentStepLabel,
      stepsCompleted: codeAnalysisJobs.stepsCompleted,
      tokensIn: codeAnalysisJobs.tokensIn,
      tokensOut: codeAnalysisJobs.tokensOut,
      turnsUsed: codeAnalysisJobs.turnsUsed,
      error: codeAnalysisJobs.error,
      createdAt: codeAnalysisJobs.createdAt,
      startedAt: codeAnalysisJobs.startedAt,
      finishedAt: codeAnalysisJobs.finishedAt,
    })
    .from(codeAnalysisJobs)
    .where(eq(codeAnalysisJobs.projectId, project.id))
    .orderBy(desc(codeAnalysisJobs.createdAt))
    .limit(1)

  return NextResponse.json({
    job: latest ?? null,
    project: {
      sourceType: project.sourceType,
      repoUrl: project.repoUrl,
      repoBranch: project.repoBranch,
      hasBusinessContext:
        !!project.businessContext && project.businessContext.trim().length > 0,
    },
  })
}
