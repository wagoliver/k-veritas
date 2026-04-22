import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CodeAnalysisPhase, ScenarioTarget } from './db.ts'

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
const SCENARIO_TEST_SYSTEM_PATH = join(
  __dirname,
  '..',
  'prompts',
  'scenario-test-system.md',
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
  scenarioTarget?: ScenarioTarget
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
    phase === 'structure'
      ? STRUCTURE_SYSTEM_PATH
      : phase === 'scenario_test'
        ? SCENARIO_TEST_SYSTEM_PATH
        : KVERITAS_SYSTEM_PATH
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
 *   - structure:     features.json (inventário).
 *   - tests:         manifest.json + .spec.ts por feature (legado).
 *   - scenario_test: UM .spec.ts pra um cenário específico.
 */
export function buildUserPrompt(input: PromptInput): string {
  if (input.phase === 'scenario_test') {
    if (!input.scenarioTarget) {
      throw new Error(
        'buildUserPrompt: scenario_test exige scenarioTarget no input',
      )
    }
    const target = input.scenarioTarget
    const outputFile = join(input.outputDir, 'test.spec.ts')
    const understanding =
      (target.featureAiUnderstanding ?? '').trim().length > 0
        ? `\nEntendimento da feature (escrito pela IA e revisado pela QA):\n\n${target.featureAiUnderstanding!.trim()}\n`
        : ''

    return `Gere UM arquivo .spec.ts Playwright pra o cenário abaixo, do projeto "${input.projectName}" (cwd: ${input.repoRoot}).

== Feature ==
Nome: ${target.featureName}
Rotas: ${target.featurePaths.join(', ') || '(nenhuma rota listada)'}${understanding}
== Cenário ==
Descrição: ${target.scenarioDescription}
Prioridade: ${target.scenarioPriority}

== Contexto do projeto ==
Leia ${input.jobRoot}/context.md — contém regra de negócio, cenários desejados e tipos de teste (e2e/smoke/regression/integration) definidos pela QA no projeto.

== Checklist obrigatório (na ordem) ==

1. **package.json** — identificar framework.
2. **Grep \`data-testid=\`** nos paths da feature (${target.featurePaths.join(', ') || 'paths não listados'}). Liste os testIds encontrados explicitamente antes de decidir seletores.
3. **Read** dos arquivos de rota (ex.: \`page.tsx\`) pra identificar inputs e botões.
4. **Detectar i18n:** se aparecer \`t('...')\`, \`$t('...')\`, \`<FormattedMessage>\`, etc., você precisa **Read do arquivo de locale** (messages/<locale>.json, locales/<locale>/*.json, etc.) pra resolver os textos reais. Target locale aqui: **${input.targetLocale}**.
5. **Alarme de idioma:** se target_locale = ${input.targetLocale} (não-inglês) mas você só achou strings em inglês, volte e procure o arquivo de locale que você pulou.
6. **Escreva o spec** em:

   ${outputFile}

== Lembre-se ==

- **Citação obrigatória** de origem em cada seletor (ex.: \`// testid extraído de src/app/login/page.tsx:34\`). Se não consegue citar, não viu — use TODO honesto.
- **Proibido:** chutar tradução, \`process.env.X || 'default'\`, seletor sem fonte.
- **Um \`test()\`** com tag \`@smoke\` se prioridade=critical, \`@regression\` se high, nenhuma tag se normal/low.
- **3+ asserções** no caminho feliz (URL + elemento visível + ausência de erro).
- Nome do \`test()\` no idioma do target_locale: **${input.targetLocale}**.

As regras completas estão no system prompt — siga-as estritamente.

Quando terminar de escrever o arquivo, responda APENAS:

  done: spec written
`
  }

  if (input.phase === 'structure') {
    return `Analise a ESTRUTURA do projeto "${input.projectName}" no diretório atual (cwd já é o repositório clonado: ${input.repoRoot}).

Esta é a **fase 1 — Organização**. Você NÃO deve ler componentes nem gerar cenários ou código de teste. O objetivo é mapear rotas e propor um agrupamento em features, rápido e barato.

Antes de explorar o código, leia o arquivo de planejamento da QA:

  ${input.jobRoot}/context.md

Esse arquivo descreve a regra de negócio do sistema, os cenários de teste desejados e os tipos de teste (e2e, smoke, regression, integration) que a QA quer cobrir. Pode estar vazio. Use esse contexto pra **agrupar as features de forma alinhada à intenção da QA** (ex.: se a regra fala de "login anti-enumeração", agrupe rotas de autenticação numa feature clara). Não invente features que não existem no código.

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
        "rationale": "Por que essas rotas formam uma feature",
        "aiUnderstanding": "2-5 frases em prosa sobre como a feature funciona, baseado no que você leu do código",
        "aiScenarios": [
          { "description": "Caminho feliz descrito em linguagem de QA", "priority": "critical" },
          { "description": "Variação/erro esperado", "priority": "high" },
          { "description": "...", "priority": "normal" }
        ]
      }
    ]
  }

Idioma obrigatório (summary, name, description, rationale, aiUnderstanding, aiScenarios): "${input.targetLocale}".

Regras estritas da fase 'structure' estão no system prompt — siga-as. Quando terminar, responda com uma única linha:

  done: N features, K paths, S scenarios
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
