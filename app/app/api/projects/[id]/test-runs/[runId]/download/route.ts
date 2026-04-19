import { type NextRequest, NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { generatedTests, projectTestRuns } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — empacota todos os arquivos gerados do run em um ZIP e retorna.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id, runId } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const [run] = await db
    .select({ id: projectTestRuns.id, status: projectTestRuns.status })
    .from(projectTestRuns)
    .where(
      and(
        eq(projectTestRuns.id, runId),
        eq(projectTestRuns.projectId, project.id),
      ),
    )
    .limit(1)

  if (!run) return Problems.forbidden()
  if (run.status !== 'completed') {
    return Problems.conflict(
      'run_not_completed',
      'O run ainda não foi concluído com sucesso.',
    )
  }

  const files = await db
    .select({
      filePath: generatedTests.filePath,
      fileContent: generatedTests.fileContent,
    })
    .from(generatedTests)
    .where(eq(generatedTests.testRunId, runId))
    .orderBy(asc(generatedTests.filePath))

  if (files.length === 0) {
    return Problems.conflict('no_files', 'Nenhum arquivo gerado neste run.')
  }

  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  // tests/ como pasta raiz dentro do ZIP
  const root = zip.folder('tests') ?? zip
  for (const f of files) {
    root.file(f.filePath, f.fileContent)
  }

  // README com instruções mínimas
  root.file(
    'README.md',
    readmeContent(project.slug, project.name, runId, files.length),
  )

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const filename = `${project.slug}-tests-${runId.slice(0, 8)}.zip`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  })
}

function readmeContent(
  slug: string,
  name: string,
  runId: string,
  filesCount: number,
): string {
  return `# ${name} — testes gerados

Run ID: \`${runId}\`
Projeto: \`${slug}\`
Arquivos: ${filesCount}

## Como usar

\`\`\`bash
# Dentro de um projeto Playwright:
cp -r tests/ tests/  # ou mescla com a estrutura existente
npx playwright install
npx playwright test
\`\`\`

As credenciais dos testes esperam as variáveis:

- \`TEST_USERNAME\`
- \`TEST_PASSWORD\`

Revise os arquivos antes de rodar — a geração é um ponto de partida, não
um produto final. Procure comentários \`// TODO\` que sinalizam pontos
onde o crawler não capturou um controle.
`
}
