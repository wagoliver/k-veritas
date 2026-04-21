import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CodeAnalysisPhase } from './db.ts'

// Caminho dos prompts montados no container. São resolvidos relativos a
// este arquivo (src/prompt.ts), então `/app/prompts/...` dentro do
// container e `./prompts/...` em dev local.
const __dirname = dirname(fileURLToPath(import.meta.url))
const KVERITAS_SYSTEM_PATH = join(
  __dirname,
  '..',
  'prompts',
  'kveritas-system.md',
)
const STRUCTURE_SYSTEM_PATH = join(
  __dirname,
  '..',
  'prompts',
  'structure-system.md',
)

// Limite de leitura pra um CLAUDE.md de repo: evita estourar o context
// window quando o projeto tem docs gigantes. 256KB bate muito bem.
const MAX_REPO_CLAUDE_BYTES = 256 * 1024

export interface PromptInput {
  projectName: string
  targetLocale: string
  jobRoot: string // /work/<jobId>
  outputDir: string // /work/<jobId>/output
  repoRoot: string // /work/<jobId>/repo
  phase: CodeAnalysisPhase
}

/**
 * Monta o system prompt em camadas, na ordem de precedência:
 *
 *   1. Prompt mestre por-fase (structure-system.md OU kveritas-system.md)
 *   2. CLAUDE.md do repo (se existir — adiciona contexto específico do projeto)
 */
export async function buildSystemPrompt(
  repoRoot: string,
  phase: CodeAnalysisPhase,
): Promise<string> {
  const masterPath =
    phase === 'structure' ? STRUCTURE_SYSTEM_PATH : KVERITAS_SYSTEM_PATH
  const master = await readFile(masterPath, 'utf8')

  let repoClaudeMd = ''
  try {
    const buf = await readFile(join(repoRoot, 'CLAUDE.md'))
    const text = buf.subarray(0, MAX_REPO_CLAUDE_BYTES).toString('utf8')
    const truncated = buf.byteLength > MAX_REPO_CLAUDE_BYTES
    repoClaudeMd = [
      '',
      '---',
      '',
      '# CLAUDE.md do repositório clonado',
      '',
      '> Regras específicas deste projeto. Respeite desde que não contradigam',
      '> o sistema-prompt MESTRE do k-veritas acima.',
      '',
      text,
      truncated
        ? `\n> (truncado em ${MAX_REPO_CLAUDE_BYTES} bytes de ${buf.byteLength})`
        : '',
    ].join('\n')
  } catch {
    // Repo não tem CLAUDE.md — ok, o system prompt mestre basta.
  }

  return master + repoClaudeMd
}

/**
 * User prompt da rodada. Divergente por fase:
 *   - structure: só pede features.json (inventário, sem cenários/testes).
 *   - tests:     pede manifest.json (cenários) + .spec.ts por feature.
 */
export function buildUserPrompt(input: PromptInput): string {
  if (input.phase === 'structure') {
    return `Analise a ESTRUTURA do projeto "${input.projectName}" no diretório atual (cwd já é o repositório clonado: ${input.repoRoot}).

Esta é a **fase 1 — Organização**. Você NÃO deve ler componentes nem gerar cenários ou código de teste. O objetivo é mapear rotas e propor um agrupamento em features, rápido e barato.

Escreva APENAS:

  ${input.outputDir}/features.json

Formato esperado:

  {
    "summary": "Resumo curto do sistema (2-3 frases)",
    "inferredLocale": "${input.targetLocale}",
    "features": [
      {
        "id": "slug-kebab-case",
        "name": "Nome legível",
        "description": "Uma frase sobre a capacidade",
        "paths": ["/rota", "/outra"],
        "rationale": "Por que essas rotas formam uma feature"
      }
    ]
  }

Idioma obrigatório (summary, name, description, rationale): "${input.targetLocale}".

Regras estritas da fase 'structure' estão no system prompt — siga-as. Quando terminar, responda com uma única linha:

  done: N features, K paths
`
  }

  return `Analise o projeto "${input.projectName}" no diretório atual (cwd já é o repositório clonado: ${input.repoRoot}).

Antes de explorar o código, leia o arquivo de contexto da QA:

  ${input.jobRoot}/context.md

Esse arquivo descreve, em texto livre escrito pela QA, os casos de uso e
as regras de negócio que ela quer cobrir nesta rodada. Pode estar vazio —
se estiver, trabalhe só com o código.

Depois de explorar o repositório e formar seu entendimento, escreva:

  1. ${input.outputDir}/manifest.json        (features + scenarios)
  2. ${input.outputDir}/tests/<feature-id>.spec.ts   (um arquivo por feature)

Idioma obrigatório da saída (manifest): "${input.targetLocale}".

As especificações estão no system prompt — siga elas estritamente.
Quando terminar, responda com uma única linha:

  done: N features, M scenarios, K spec files
`
}
