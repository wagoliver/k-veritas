import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { db } from '@/lib/db/pg'
import { projects } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { authorizeProject } from '@/lib/auth/project-access'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATA_DIR = process.env.DATA_DIR ?? '/data'
// 100 MB. Alinhado com o limite HTTP típico e o que é razoável pra um
// snapshot enxuto de um repo frontend. Repositórios maiores que isso
// devem preferir git clone com PAT ou reduzir escopo da pasta.
const MAX_BYTES = 100 * 1024 * 1024
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // PK\x03\x04

/**
 * POST — recebe um .zip do repositório por upload multipart. Salva em
 * /data/projects/<id>/source.zip (sobrescreve), zera repo_url pra não
 * ficar ambíguo qual fonte usar, e atualiza repo_zip_path relativo a
 * DATA_DIR. O codex já tem fallback pra repo_zip_path em clone.ts —
 * não precisa de mais nada no worker.
 */
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

  const rl = await consumeToken(BUCKETS.codeAnalyzeProject(project.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  // Só projetos code-first (sourceType='repo') têm fonte de código. Se
  // criaram como 'url' não faz sentido subir repo.
  if (project.sourceType !== 'repo') {
    return Problems.invalidBody({ source: 'not_repo_project' })
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return Problems.invalidBody({ contentType: 'expected_multipart' })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Problems.invalidBody({ form: 'parse_failed' })
  }

  const file = form.get('file')
  if (!file || !(file instanceof File)) {
    return Problems.invalidBody({ file: 'missing' })
  }
  if (file.size === 0) {
    return Problems.invalidBody({ file: 'empty' })
  }
  if (file.size > MAX_BYTES) {
    return Problems.invalidBody({ file: 'too_large' })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  // Valida magic bytes — precisa ser ZIP (PK\x03\x04). Evita upload de
  // arquivos com extensão .zip mas conteúdo arbitrário.
  if (buffer.byteLength < 4 || buffer.subarray(0, 4).compare(ZIP_MAGIC) !== 0) {
    return Problems.invalidBody({ file: 'not_a_zip' })
  }

  const relativePath = join('projects', project.id, 'source.zip')
  const absolutePath = join(DATA_DIR, relativePath)
  const dir = join(DATA_DIR, 'projects', project.id)
  await mkdir(dir, { recursive: true })
  await writeFile(absolutePath, buffer)

  await db
    .update(projects)
    .set({
      repoZipPath: relativePath,
      // Limpa repoUrl pra evitar ambiguidade de fonte. O fluxo git
      // clone volta quando o usuário setar uma repo_url de novo.
      repoUrl: null,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id))

  await audit({
    userId: session.user.id,
    event: 'project_repo_zip_uploaded',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: {
      projectId: project.id,
      bytes: file.size,
      fileName: file.name,
    },
    outcome: 'success',
  })

  return NextResponse.json({
    repoZipPath: relativePath,
    bytes: file.size,
    uploadedAt: new Date().toISOString(),
  })
}

/**
 * DELETE — remove o ZIP cadastrado. Volta pro estado "sem fonte" ou
 * "vai usar repo_url de novo" conforme o usuário editar depois.
 */
export async function DELETE(
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

  if (!project.repoZipPath) {
    return new NextResponse(null, { status: 204 })
  }

  // Não apaga o arquivo em disco (o codex já cloneia por cima em cada
  // análise; o ZIP antigo vira lixo inofensivo). Só desassocia no DB.
  await db
    .update(projects)
    .set({ repoZipPath: null, updatedAt: new Date() })
    .where(eq(projects.id, project.id))

  await audit({
    userId: session.user.id,
    event: 'project_repo_zip_removed',
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { projectId: project.id },
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
