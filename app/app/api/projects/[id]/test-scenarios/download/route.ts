import { type NextRequest } from 'next/server'
import { eq, asc } from 'drizzle-orm'
import JSZip from 'jszip'

import { db } from '@/lib/db/pg'
import {
  analysisFeatures,
  featureAiScenarioTests,
} from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject, slugify } from '@/lib/auth/project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — empacota em ZIP todos os .spec.ts gerados pelo codex pra este
 * projeto, organizados em tests/<feature>/<scenario>.spec.ts.
 *
 * Só inclui features aprovadas e cenários que realmente têm teste gerado
 * (presentes em feature_ai_scenario_tests). Features/cenários pendentes
 * ficam fora — eles aparecem na tela Cenários.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  // Carrega features aprovadas do projeto.
  const features = await db
    .select({
      id: analysisFeatures.id,
      externalId: analysisFeatures.externalId,
      name: analysisFeatures.name,
      aiScenarios: analysisFeatures.aiScenarios,
      approvedAt: analysisFeatures.approvedAt,
    })
    .from(analysisFeatures)
    .where(eq(analysisFeatures.projectId, project.id))
    .orderBy(asc(analysisFeatures.sortOrder))

  // Carrega todos os testes gerados do projeto.
  const tests = await db
    .select()
    .from(featureAiScenarioTests)
    .where(eq(featureAiScenarioTests.projectId, project.id))

  const testsByKey = new Map<string, string>()
  for (const t of tests) {
    testsByKey.set(`${t.featureId}:${t.scenarioId}`, t.code)
  }

  const zip = new JSZip()
  const tests_root = zip.folder('tests')
  if (!tests_root) return Problems.server('zip_init_failed')

  // Dedup de paths dentro do zip: se dois cenários produzem o mesmo slug,
  // anexamos um índice -2, -3, etc.
  const usedPaths = new Set<string>()
  let total = 0

  for (const f of features) {
    if (!f.approvedAt) continue // features não aprovadas ficam fora
    const scenarios = Array.isArray(f.aiScenarios)
      ? (f.aiScenarios as Array<{
          id?: string
          description?: string
        }>)
      : []

    const featureSlug =
      f.externalId && f.externalId.length > 0
        ? f.externalId
        : slugify(f.name)

    const featureDir = tests_root.folder(featureSlug)
    if (!featureDir) continue

    for (const s of scenarios) {
      if (!s.id || typeof s.description !== 'string') continue
      const code = testsByKey.get(`${f.id}:${s.id}`)
      if (!code) continue

      const baseName = slugify(s.description).slice(0, 60) || s.id.slice(0, 8)
      let filename = `${baseName}.spec.ts`
      let suffix = 2
      while (usedPaths.has(`${featureSlug}/${filename}`)) {
        filename = `${baseName}-${suffix}.spec.ts`
        suffix += 1
      }
      usedPaths.add(`${featureSlug}/${filename}`)

      featureDir.file(filename, code)
      total += 1
    }
  }

  if (total === 0) {
    return Problems.conflict(
      'no_tests_generated',
      'Nenhum teste gerado ainda — gere testes na tela Cenários antes de baixar.',
    )
  }

  // README com instruções mínimas de uso. Sem entrar em config de
  // Playwright — deixa o projeto decidir como integrar.
  zip.file(
    'README.md',
    [
      `# Testes gerados — k-veritas`,
      ``,
      `Projeto: ${project.name}`,
      `Total de specs: ${total}`,
      ``,
      `Cada arquivo assume que você tem Playwright configurado e \`baseURL\``,
      `apontando pro ambiente certo. Env vars esperadas: \`E2E_USER\`, \`E2E_PASSWORD\``,
      `e similares, dependendo do cenário.`,
      ``,
    ].join('\n'),
  )

  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer
  const fname = `${project.slug}-tests-${new Date()
    .toISOString()
    .slice(0, 10)}.zip`

  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
