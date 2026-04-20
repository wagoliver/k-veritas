import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Caminho do kveritas-system.md montado no container. É resolvido
// relativo a este arquivo (src/prompt.ts), então `/app/prompts/...`
// dentro do container e `./prompts/...` em dev local.
const __dirname = dirname(fileURLToPath(import.meta.url))
const KVERITAS_SYSTEM_PATH = join(__dirname, '..', 'prompts', 'kveritas-system.md')

// Limite de leitura pra um CLAUDE.md de repo: evita estourar o context
// window quando o projeto tem docs gigantes. 256KB bate muito bem.
const MAX_REPO_CLAUDE_BYTES = 256 * 1024

export interface PromptInput {
  projectName: string
  targetLocale: string
  jobRoot: string // /work/<jobId>
  outputDir: string // /work/<jobId>/output
  repoRoot: string // /work/<jobId>/repo
}

/**
 * Monta o system prompt em camadas, na ordem de precedência:
 *
 *   1. kveritas-system.md (sempre presente, prevalece em conflitos)
 *   2. CLAUDE.md do repo (se existir — adiciona contexto específico do projeto)
 *
 * O context.md da QA (business_context) NÃO entra aqui — ele é
 * referenciado via user prompt e lido pelo modelo como arquivo do
 * workspace. Isso porque é por-rodada, enquanto o system é estável.
 */
export async function buildSystemPrompt(repoRoot: string): Promise<string> {
  const kveritas = await readFile(KVERITAS_SYSTEM_PATH, 'utf8')

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

  return kveritas + repoClaudeMd
}

/**
 * User prompt da rodada. Curto e específico — o grosso das regras vive
 * no system prompt. Referencia explicitamente onde a QA escreveu o
 * contexto de negócio e onde o Claude deve escrever os artefatos.
 */
export function buildUserPrompt(input: PromptInput): string {
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
