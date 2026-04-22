import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { upsertScenarioTest } from './db.ts'

const EXPECTED_FILE = 'test.spec.ts'

/**
 * Importa o `.spec.ts` escrito pelo Claude Code na fase `scenario_test`
 * pro banco (tabela `feature_ai_scenario_tests`). Upsert: regenerar o
 * mesmo cenário sobrescreve o código anterior.
 *
 * O arquivo DEVE estar em `<outputDir>/test.spec.ts`. Se não estiver,
 * o worker propaga o erro pra marcar o job como failed.
 */
export async function importScenarioTestManifest(params: {
  projectId: string
  featureId: string
  scenarioId: string
  requestedBy: string
  model: string
  provider: string
  outputDir: string
  tokensIn: number
  tokensOut: number
}): Promise<{ bytes: number }> {
  const abs = join(params.outputDir, EXPECTED_FILE)
  let code: string
  try {
    code = await readFile(abs, 'utf8')
  } catch (err) {
    // Fallback: às vezes o modelo escreve em output/tests/x.spec.ts — procura
    // o primeiro .spec.ts na pasta como safety net.
    const fallback = await findFirstSpec(params.outputDir)
    if (!fallback) {
      throw new Error(
        `spec não encontrado em ${abs} — Claude não escreveu o arquivo esperado: ${
          (err as Error).message
        }`,
      )
    }
    code = await readFile(fallback, 'utf8')
  }

  const trimmed = code.trim()
  if (trimmed.length < 40) {
    throw new Error(`spec vazio/inválido (${trimmed.length} bytes)`)
  }
  if (!trimmed.includes('test(')) {
    throw new Error('spec não contém chamada test() — conteúdo inválido')
  }
  if (!trimmed.includes("'@playwright/test'") && !trimmed.includes('"@playwright/test"')) {
    throw new Error('spec sem import do @playwright/test')
  }

  await upsertScenarioTest({
    projectId: params.projectId,
    featureId: params.featureId,
    scenarioId: params.scenarioId,
    code: trimmed,
    model: params.model,
    provider: params.provider,
    tokensIn: params.tokensIn,
    tokensOut: params.tokensOut,
    requestedBy: params.requestedBy,
  })

  return { bytes: trimmed.length }
}

async function findFirstSpec(root: string): Promise<string | null> {
  // Busca em profundidade 2. Nome contendo .spec.ts.
  const queue: string[] = [root]
  let depth = 0
  while (queue.length > 0 && depth < 2) {
    const batch = queue.splice(0)
    for (const dir of batch) {
      let entries: Awaited<ReturnType<typeof readdir>>
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const abs = join(dir, e.name)
        if (e.isFile() && /\.spec\.(ts|tsx|js|jsx)$/.test(e.name)) {
          return abs
        }
        if (e.isDirectory()) {
          queue.push(abs)
        }
      }
    }
    depth += 1
  }
  // Último fallback: stat explícito na raiz pra garantir que não era file
  try {
    const s = await stat(root)
    if (s.isFile() && /\.spec\.(ts|tsx|js|jsx)$/.test(root)) return root
  } catch {
    // ignore
  }
  return null
}
