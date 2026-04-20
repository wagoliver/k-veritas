import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { env } from './env.ts'
import { importAnalysis } from './db.ts'

const DATA_DIR = env('DATA_DIR', '/data')

// Shape mínimo que o worker exige do manifest.json. Qualquer validação
// mais rigorosa (o AnalysisSchema completo em Zod) fica no produto, no
// caminho de leitura/edição. Aqui só checamos o suficiente pra importar
// sem quebrar FKs ou invariantes de tipo.
interface ManifestScenario {
  title: string
  rationale: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  preconditions?: string[]
  dataNeeded?: string[]
}
interface ManifestFeature {
  id?: string
  name: string
  description: string
  paths: string[]
  scenarios: ManifestScenario[]
}
interface Manifest {
  summary: string
  inferredLocale: string
  features: ManifestFeature[]
}

function toKebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `feature-${Math.random().toString(36).slice(2, 8)}`
}

function validate(obj: unknown): asserts obj is Manifest {
  if (!obj || typeof obj !== 'object') {
    throw new Error('manifest vazio ou não é objeto')
  }
  const m = obj as Partial<Manifest>
  if (typeof m.summary !== 'string' || m.summary.trim().length < 10) {
    throw new Error('manifest.summary inválido')
  }
  if (typeof m.inferredLocale !== 'string') {
    throw new Error('manifest.inferredLocale inválido')
  }
  if (!Array.isArray(m.features) || m.features.length === 0) {
    throw new Error('manifest.features vazio')
  }
  for (const f of m.features) {
    if (!f || typeof f.name !== 'string') throw new Error('feature sem name')
    if (!Array.isArray(f.paths) || f.paths.length === 0) {
      throw new Error(`feature "${f.name}" sem paths`)
    }
    if (!Array.isArray(f.scenarios) || f.scenarios.length < 1) {
      throw new Error(`feature "${f.name}" sem scenarios`)
    }
    for (const s of f.scenarios) {
      if (typeof s.title !== 'string' || typeof s.rationale !== 'string') {
        throw new Error(`scenario em "${f.name}" com campos faltando`)
      }
      if (!['critical', 'high', 'normal', 'low'].includes(s.priority)) {
        throw new Error(`scenario "${s.title}" com priority inválido`)
      }
    }
  }
}

export async function importManifest(params: {
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
  const manifestAbs = join(params.outputDir, 'manifest.json')
  const content = await readFile(manifestAbs, 'utf8')
  const parsed: unknown = JSON.parse(content)
  validate(parsed)

  // Path relativo ao /data pra caber em uma coluna text sem prefixo de host.
  const manifestPath = relative(DATA_DIR, manifestAbs) || manifestAbs

  const analysisId = await importAnalysis({
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
      scenarios: f.scenarios.map((s) => ({
        title: s.title,
        rationale: s.rationale,
        priority: s.priority,
        preconditions: s.preconditions ?? [],
        dataNeeded: s.dataNeeded ?? [],
      })),
    })),
  })

  return { analysisId, manifestPath }
}
