import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { env } from './env.ts'
import { importStructure } from './db.ts'

const DATA_DIR = env('DATA_DIR', '/data')

// Shape do features.json escrito pelo Claude Code na fase 'structure'.
// É mais enxuto que o manifest da fase 'tests' — sem cenários, sem
// preconditions, sem dataNeeded.
interface StructureFeature {
  id?: string
  name: string
  description: string
  paths: string[]
  rationale?: string
}

interface StructureManifest {
  summary: string
  inferredLocale: string
  features: StructureFeature[]
}

function toKebab(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `feature-${Math.random().toString(36).slice(2, 8)}`
  )
}

function validate(obj: unknown): asserts obj is StructureManifest {
  if (!obj || typeof obj !== 'object') {
    throw new Error('features.json vazio ou não é objeto')
  }
  const m = obj as Partial<StructureManifest>
  if (typeof m.summary !== 'string' || m.summary.trim().length < 10) {
    throw new Error('features.json sem summary válido')
  }
  if (typeof m.inferredLocale !== 'string') {
    throw new Error('features.json sem inferredLocale')
  }
  if (!Array.isArray(m.features) || m.features.length === 0) {
    throw new Error('features.json com features vazio')
  }
  for (const f of m.features) {
    if (!f || typeof f.name !== 'string') {
      throw new Error('feature sem name')
    }
    if (!Array.isArray(f.paths) || f.paths.length === 0) {
      throw new Error(`feature "${f.name}" sem paths`)
    }
    if (typeof f.description !== 'string') {
      throw new Error(`feature "${f.name}" sem description`)
    }
  }
}

export async function importStructureManifest(params: {
  jobId: string
  projectId: string
  requestedBy: string
  model: string
  provider: string
  outputDir: string
  durationMs: number
  tokensIn: number
  tokensOut: number
}): Promise<{ analysisId: string; manifestPath: string }> {
  const manifestAbs = join(params.outputDir, 'features.json')
  const content = await readFile(manifestAbs, 'utf8')
  const parsed: unknown = JSON.parse(content)
  validate(parsed)

  const manifestPath = relative(DATA_DIR, manifestAbs) || manifestAbs

  const analysisId = await importStructure({
    jobId: params.jobId,
    projectId: params.projectId,
    requestedBy: params.requestedBy,
    model: params.model,
    provider: params.provider,
    summary: parsed.summary,
    inferredLocale: parsed.inferredLocale,
    manifestPath,
    durationMs: params.durationMs,
    tokensIn: params.tokensIn,
    tokensOut: params.tokensOut,
    features: parsed.features.map((f) => ({
      externalId: f.id ?? toKebab(f.name),
      name: f.name,
      description: f.description,
      paths: f.paths,
    })),
  })

  return { analysisId, manifestPath }
}
