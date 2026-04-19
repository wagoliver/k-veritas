import { type NextRequest, NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import {
  featureTestFiles,
  projectTestRuns,
  scenarioTests,
} from '@/lib/db/schema'
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

  // Busca header/footer por feature + todos os snippets de scenario
  const features = await db
    .select({
      filePath: featureTestFiles.filePath,
      featureExternalIdSnapshot: featureTestFiles.featureExternalIdSnapshot,
      fileHeader: featureTestFiles.fileHeader,
      fileFooter: featureTestFiles.fileFooter,
    })
    .from(featureTestFiles)
    .where(eq(featureTestFiles.testRunId, runId))
    .orderBy(asc(featureTestFiles.filePath))

  const snippets = await db
    .select({
      featureExternalIdSnapshot: scenarioTests.featureExternalIdSnapshot,
      code: scenarioTests.code,
    })
    .from(scenarioTests)
    .where(eq(scenarioTests.testRunId, runId))
    .orderBy(asc(scenarioTests.createdAt))

  if (features.length === 0) {
    return Problems.conflict('no_files', 'Nenhum arquivo gerado neste run.')
  }

  // Agrupa snippets por feature
  const snippetsByFeature = new Map<string, string[]>()
  for (const s of snippets) {
    const arr = snippetsByFeature.get(s.featureExternalIdSnapshot) ?? []
    arr.push(s.code)
    snippetsByFeature.set(s.featureExternalIdSnapshot, arr)
  }

  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const root = zip.folder('tests') ?? zip

  // Reconstrói cada arquivo: header + tests.join + footer
  for (const f of features) {
    const codes = snippetsByFeature.get(f.featureExternalIdSnapshot) ?? []
    // Indenta cada test 2 espaços (dentro do describe)
    const indented = codes.map((c) =>
      c
        .split('\n')
        .map((line) => (line.length > 0 ? `  ${line}` : line))
        .join('\n'),
    )
    const content = `${f.fileHeader}\n${indented.join('\n\n')}\n${f.fileFooter}`
    root.file(f.filePath, content)
  }

  // README com instruções mínimas
  root.file(
    'README.md',
    readmeContent(project.slug, project.name, runId, features.length),
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
