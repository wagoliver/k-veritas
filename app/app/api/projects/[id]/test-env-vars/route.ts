import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db/pg'
import {
  featureAiScenarioTests,
  projectTestEnvVars,
} from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { encryptSecret } from '@/lib/auth/totp'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Z_][A-Z0-9_]*$/, 'env var deve ser UPPER_SNAKE_CASE')

const putSchema = z.object({
  vars: z
    .array(
      z.object({
        name: nameSchema,
        // valor opcional: string = grava/atualiza; undefined = preserva existente.
        value: z.string().max(4000).optional(),
      }),
    )
    .max(100),
  // nomes que a QA removeu na tela — apaga do banco.
  deletedNames: z.array(nameSchema).max(100).optional(),
})

/**
 * Scaneia o código de todos os .spec.ts do projeto em busca de
 * `process.env.<NOME>` e devolve os nomes únicos. Usado pra auto-popular
 * a UI com variáveis que os testes precisam, mesmo que a QA ainda não
 * tenha cadastrado valor.
 */
function detectEnvVarNames(codes: string[]): string[] {
  const found = new Set<string>()
  const regex = /process\.env\.([A-Z_][A-Z0-9_]*)/g
  for (const code of codes) {
    let m: RegExpExecArray | null
    while ((m = regex.exec(code)) !== null) {
      found.add(m[1])
    }
  }
  return Array.from(found).sort()
}

/**
 * GET — lista todas as variáveis relevantes pro projeto:
 *   - cadastradas (com flag hasValue, nunca o valor em si)
 *   - detectadas nos specs mas sem valor ainda (hasValue=false)
 *
 * Essa união ajuda a QA a ver tudo o que precisa preencher.
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

  const stored = await db
    .select({
      name: projectTestEnvVars.name,
      updatedAt: projectTestEnvVars.updatedAt,
    })
    .from(projectTestEnvVars)
    .where(eq(projectTestEnvVars.projectId, project.id))
    .orderBy(asc(projectTestEnvVars.name))

  const specs = await db
    .select({ code: featureAiScenarioTests.code })
    .from(featureAiScenarioTests)
    .where(eq(featureAiScenarioTests.projectId, project.id))
  const detected = detectEnvVarNames(specs.map((s) => s.code))

  const storedNames = new Set(stored.map((r) => r.name))
  const merged = [
    ...stored.map((r) => ({
      name: r.name,
      hasValue: true,
      detected: detected.includes(r.name),
      updatedAt: r.updatedAt,
    })),
    ...detected
      .filter((n) => !storedNames.has(n))
      .map((n) => ({
        name: n,
        hasValue: false,
        detected: true,
        updatedAt: null,
      })),
  ].sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json(
    { vars: merged },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * PUT — bulk upsert. Envia a lista completa do que deve existir no
 * projeto. Vars com `value` são (re)cifradas e persistidas; vars em
 * `deletedNames` são removidas. Nomes da lista sem `value` são ignorados
 * (preserva o valor já cadastrado).
 */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const { id } = await ctx.params
  const project = await authorizeProject(session.user.id, id)
  if (!project) return Problems.forbidden()

  const body = await req.json().catch(() => null)
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const now = new Date()

  await db.transaction(async (tx) => {
    if (parsed.data.deletedNames && parsed.data.deletedNames.length > 0) {
      await tx
        .delete(projectTestEnvVars)
        .where(
          and(
            eq(projectTestEnvVars.projectId, project.id),
            inArray(projectTestEnvVars.name, parsed.data.deletedNames),
          ),
        )
    }

    for (const v of parsed.data.vars) {
      if (v.value === undefined) continue
      const encrypted = encryptSecret(v.value)
      await tx
        .insert(projectTestEnvVars)
        .values({
          projectId: project.id,
          name: v.name,
          valueEncrypted: encrypted,
          updatedBy: session.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [projectTestEnvVars.projectId, projectTestEnvVars.name],
          set: {
            valueEncrypted: encrypted,
            updatedBy: session.user.id,
            updatedAt: now,
          },
        })
    }
  })

  await audit({
    userId: session.user.id,
    event: 'project_test_env_vars_updated',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: {
      projectId: project.id,
      setCount: parsed.data.vars.filter((v) => v.value !== undefined).length,
      deletedCount: parsed.data.deletedNames?.length ?? 0,
    },
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
