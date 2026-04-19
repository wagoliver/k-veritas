/**
 * Parser heurístico para o bloco test(...) gerado pelo LLM.
 *
 * Não é um parser TypeScript real — usa regex + pattern match em cada
 * linha. Isso é por escolha: o código gerado segue um subset previsível
 * (test(...) + comentários Given/When/Then + await page.xxx.yyy()) e um
 * parser completo seria desproporcional.
 *
 * NUNCA lança: qualquer linha que não case com padrão conhecido vira
 * kind='raw', mantendo o usuário informado sem quebrar a UI.
 */

export type StepKind =
  | 'goto'
  | 'click'
  | 'fill'
  | 'select'
  | 'hover'
  | 'check'
  | 'press'
  | 'locator'
  | 'assertion'
  | 'wait'
  | 'raw'

export type PhaseKind = 'given' | 'when' | 'then' | 'setup'

export interface ParsedStep {
  kind: StepKind
  /** Verbo humano curto, derivado do código. Ex.: 'Clicar em "Dashboard"'. */
  verb: string
  /** Linha original do código, pra mostrar ao expandir o step. */
  rawLine: string
  /** Nome do elemento, quando extraível (getByRole({name:'X'})). */
  target: string | null
}

export interface ParsedPhase {
  kind: PhaseKind
  /** Texto após `// Given:`, `// When:`, `// Then:` quando existir. */
  description: string | null
  steps: ParsedStep[]
}

export interface ParsedTest {
  title: string
  tag: string | null
  phases: ParsedPhase[]
  /** true quando a heurística não encontrou padrão algum — usado pro fallback. */
  isUnrecognized: boolean
}

const PHASE_COMMENT_REGEX = /^\s*\/\/\s*(given|when|then)\s*:?\s*(.*)$/i
const TEST_HEADER_REGEX = /^\s*test\s*\(\s*(['"`])([\s\S]*?)\1/
const TAG_REGEX = /tag\s*:\s*(['"`])(@[\w-]+)\1/

/**
 * Tenta identificar qual step do ParsedTest causou a falha, olhando o
 * corpo da errorMessage do Playwright. Heurísticas (ordem de precedência):
 *
 *   1. errorMessage menciona o `target` do step (nome extraído do
 *      getByRole({name:'X'}), etc.)
 *   2. errorMessage cita a `rawLine` praticamente literal
 *   3. Se o erro é de navegação e tem um step kind='goto', escolhe ele
 *   4. Nenhum match: retorna null
 *
 * Retorna índice GLOBAL (flat) percorrendo phases[].steps[] em ordem.
 */
export function locateFailedStepIndex(
  parsed: ParsedTest,
  errorMessage: string | null | undefined,
): number | null {
  if (!errorMessage) return null
  const err = errorMessage

  const allSteps = flattenSteps(parsed)

  // 1. Match por target (mais específico)
  for (let i = 0; i < allSteps.length; i++) {
    const s = allSteps[i]
    if (s.target && err.includes(s.target)) return i
  }

  // 2. Match por rawLine quase-literal (trecho > 15 chars)
  for (let i = 0; i < allSteps.length; i++) {
    const s = allSteps[i]
    const snippet = s.rawLine.trim().replace(/\s+/g, ' ')
    if (snippet.length > 15 && err.replace(/\s+/g, ' ').includes(snippet)) {
      return i
    }
  }

  // 3. Palavras-chave por kind
  if (/goto|navigation|page\.goto/i.test(err)) {
    const idx = allSteps.findIndex((s) => s.kind === 'goto')
    if (idx >= 0) return idx
  }
  if (/toHaveURL|expect.*url/i.test(err)) {
    const idx = allSteps.findIndex(
      (s) => s.kind === 'assertion' && /URL/i.test(s.verb),
    )
    if (idx >= 0) return idx
  }

  return null
}

export function flattenSteps(parsed: ParsedTest): ParsedStep[] {
  const out: ParsedStep[] = []
  for (const p of parsed.phases) for (const s of p.steps) out.push(s)
  return out
}

export function parseTestCode(code: string): ParsedTest {
  const lines = code.split('\n')

  // 1. Extrai título + tag
  const joinedForHeader = lines.slice(0, 6).join(' ')
  const titleMatch = joinedForHeader.match(TEST_HEADER_REGEX)
  const title = titleMatch?.[2]?.trim() ?? 'Teste Playwright'
  const tagMatch = joinedForHeader.match(TAG_REGEX)
  const tag = tagMatch?.[2] ?? null

  // 2. Corta wrapper: remove primeira linha (test(...)) e última (})/ })
  const body = trimWrapper(lines)

  // 3. Varre linha a linha agrupando em fases
  const phases: ParsedPhase[] = []
  let current: ParsedPhase | null = null
  let recognized = false

  const pushPhaseIfNeeded = (
    kind: PhaseKind,
    description: string | null,
  ): ParsedPhase => {
    const fresh: ParsedPhase = { kind, description, steps: [] }
    phases.push(fresh)
    return fresh
  }

  for (const rawLine of body) {
    const line = rawLine.trim()
    if (line.length === 0) continue

    // Comentário de fase abre nova phase
    const phaseMatch = line.match(PHASE_COMMENT_REGEX)
    if (phaseMatch) {
      const kind = phaseMatch[1].toLowerCase() as PhaseKind
      const description = phaseMatch[2]?.trim() || null
      current = pushPhaseIfNeeded(kind, description)
      continue
    }

    // Comentário solto (não Given/When/Then) — ignora
    if (line.startsWith('//')) continue

    // Se ainda não abriu phase, cria uma 'setup' implícita
    if (!current) {
      current = pushPhaseIfNeeded('setup', null)
    }

    const step = classifyLine(rawLine)
    current.steps.push(step)
    if (step.kind !== 'raw') recognized = true
  }

  const isUnrecognized = !recognized && phases.every((p) => p.steps.length === 0)

  return { title, tag, phases, isUnrecognized }
}

/**
 * Remove a primeira linha que casa com `test(...)` e a última `})` /  `})`.
 * Tolerante: se não bater, retorna tudo.
 */
function trimWrapper(lines: string[]): string[] {
  let start = 0
  let end = lines.length

  // Procura a abertura `test(...` nas primeiras 3 linhas
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    if (/\btest\s*\(/.test(lines[i])) {
      // A abertura pode continuar em linhas seguintes até `=> {`.
      // Acha a linha que termina com '{' (abertura do corpo)
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        if (/=>\s*\{\s*$/.test(lines[j]) || /\{\s*$/.test(lines[j])) {
          start = j + 1
          break
        }
      }
      break
    }
  }

  // Remove a última `)` / `})` / `})` etc
  for (let i = lines.length - 1; i >= start; i--) {
    const trimmed = lines[i].trim()
    if (trimmed === '' || trimmed === ')' || trimmed === '}') continue
    if (/^\}\s*\)?\s*$/.test(trimmed)) {
      end = i
      break
    }
    end = i + 1
    break
  }

  return lines.slice(start, end)
}

/**
 * Classifica uma linha de código Playwright em um ParsedStep.
 * Ordem das checagens é significativa — mais específico primeiro.
 */
function classifyLine(rawLine: string): ParsedStep {
  const line = rawLine.trim()

  // expect(...).toXxx(...)
  const expectMatch = line.match(
    /expect\s*\(([\s\S]*?)\)\s*\.(to\w+)\s*\(([\s\S]*?)\)/,
  )
  if (expectMatch) {
    const subject = expectMatch[1].trim()
    const matcher = expectMatch[2]
    const arg = expectMatch[3].trim()
    const target = extractTargetName(subject)
    return {
      kind: 'assertion',
      verb: assertionVerb(matcher, subject, arg),
      rawLine,
      target,
    }
  }

  // page.goto('/...')
  const gotoMatch = line.match(/page\s*\.\s*goto\s*\(\s*(['"`])([^'"`]+)\1/)
  if (gotoMatch) {
    return {
      kind: 'goto',
      verb: `Abrir "${gotoMatch[2]}"`,
      rawLine,
      target: gotoMatch[2],
    }
  }

  // .click()
  if (/\.\s*click\s*\(\s*\)/.test(line)) {
    const target = extractTargetName(line)
    return {
      kind: 'click',
      verb: target ? `Clicar em "${target}"` : 'Clicar',
      rawLine,
      target,
    }
  }

  // .fill('...')
  const fillMatch = line.match(/\.\s*fill\s*\(\s*([\s\S]+?)\s*\)/)
  if (fillMatch) {
    const target = extractTargetName(line)
    const value = summarizeValueArg(fillMatch[1])
    return {
      kind: 'fill',
      verb: target
        ? `Preencher "${target}"${value ? ` com ${value}` : ''}`
        : `Preencher campo${value ? ` com ${value}` : ''}`,
      rawLine,
      target,
    }
  }

  // .selectOption(...)
  if (/\.\s*selectOption\s*\(/.test(line)) {
    const target = extractTargetName(line)
    return {
      kind: 'select',
      verb: target ? `Selecionar opção em "${target}"` : 'Selecionar opção',
      rawLine,
      target,
    }
  }

  // .hover()
  if (/\.\s*hover\s*\(\s*\)/.test(line)) {
    const target = extractTargetName(line)
    return {
      kind: 'hover',
      verb: target ? `Passar mouse sobre "${target}"` : 'Passar mouse',
      rawLine,
      target,
    }
  }

  // .check() / .uncheck()
  if (/\.\s*(un)?check\s*\(\s*\)/.test(line)) {
    const target = extractTargetName(line)
    const isUncheck = /\.\s*uncheck\s*\(/.test(line)
    return {
      kind: 'check',
      verb: target
        ? `${isUncheck ? 'Desmarcar' : 'Marcar'} "${target}"`
        : isUncheck
          ? 'Desmarcar'
          : 'Marcar',
      rawLine,
      target,
    }
  }

  // .press('Enter')
  const pressMatch = line.match(/\.\s*press\s*\(\s*(['"`])([^'"`]+)\1/)
  if (pressMatch) {
    return {
      kind: 'press',
      verb: `Pressionar tecla "${pressMatch[2]}"`,
      rawLine,
      target: pressMatch[2],
    }
  }

  // await page.waitFor...
  if (/\.\s*waitFor\w+\s*\(/.test(line)) {
    return {
      kind: 'wait',
      verb: 'Aguardar condição',
      rawLine,
      target: null,
    }
  }

  // const X = page.getByRole(...)
  const locatorMatch = line.match(
    /^\s*const\s+(\w+)\s*=\s*page\s*\.\s*(\w+)\s*\(\s*([\s\S]+?)\s*\)\s*$/,
  )
  if (locatorMatch) {
    const target = extractTargetName(line)
    return {
      kind: 'locator',
      verb: target
        ? `Localizar "${target}"`
        : `Criar locator (${locatorMatch[2]})`,
      rawLine,
      target,
    }
  }

  // Não reconhecido
  return {
    kind: 'raw',
    verb: line.replace(/^await\s+/, '').slice(0, 80),
    rawLine,
    target: null,
  }
}

/**
 * Tenta extrair o "name" de um getByRole/getByLabel/getByText/getByTestId
 * ou o texto de um getByText('...').
 */
function extractTargetName(code: string): string | null {
  // { name: 'Dashboard' } ou { name: "Foo" } ou { name: `bar` }
  const nameStrMatch = code.match(/name\s*:\s*(['"`])([^'"`]+)\1/)
  if (nameStrMatch) return nameStrMatch[2]

  // { name: /empresa/i } — regex, pega a parte textual pro match com o erro
  const nameRegexMatch = code.match(/name\s*:\s*\/([^/]+)\/[a-z]*/)
  if (nameRegexMatch) return nameRegexMatch[1]

  // getByText('foo') / getByLabel("bar") / getByTestId(`baz`)
  const textMatch = code.match(
    /getBy(Text|TestId|Label)\s*\(\s*(['"`])([^'"`]+)\2/,
  )
  if (textMatch) return textMatch[3]

  // getByText(/regex/) / getByLabel(/regex/)
  const textRegexMatch = code.match(
    /getBy(Text|TestId|Label)\s*\(\s*\/([^/]+)\/[a-z]*/,
  )
  if (textRegexMatch) return textRegexMatch[2]

  // getByPlaceholder('00.000.000/0000-00')
  const phMatch = code.match(
    /getByPlaceholder\s*\(\s*(['"`])([^'"`]+)\1/,
  )
  if (phMatch) return phMatch[2]

  return null
}

/**
 * Sumariza o argumento de .fill(X) — se for string curta, mostra; se for
 * process.env.X, mostra <ENV>; caso complexo, deixa vazio.
 */
function summarizeValueArg(arg: string): string {
  const stringMatch = arg.match(/^(['"`])([^'"`]*)\1/)
  if (stringMatch) {
    const value = stringMatch[2]
    if (value.length === 0) return '(vazio)'
    if (value.length > 30) return `"${value.slice(0, 27)}…"`
    return `"${value}"`
  }
  const envMatch = arg.match(/process\.env\.(\w+)/)
  if (envMatch) return `<${envMatch[1]}>`
  return ''
}

/**
 * Verbo humano a partir do matcher de expect.
 * Ex.: ('toBeVisible', 'dashboardLink', '') → 'Dashboard deve estar visível'
 */
function assertionVerb(
  matcher: string,
  subject: string,
  arg: string,
): string {
  const target = extractTargetName(subject) ?? subjectFallback(subject)
  const subjectLabel = target ? `"${target}"` : 'elemento'

  switch (matcher) {
    case 'toBeVisible':
      return `${subjectLabel} deve estar visível`
    case 'toBeHidden':
      return `${subjectLabel} deve estar oculto`
    case 'toBeEnabled':
      return `${subjectLabel} deve estar habilitado`
    case 'toBeDisabled':
      return `${subjectLabel} deve estar desabilitado`
    case 'toBeChecked':
      return `${subjectLabel} deve estar marcado`
    case 'toHaveText':
      return `${subjectLabel} deve conter texto ${summarizeValueArg(arg)}`.trim()
    case 'toContainText':
      return `${subjectLabel} deve conter texto ${summarizeValueArg(arg)}`.trim()
    case 'toHaveValue':
      return `${subjectLabel} deve ter valor ${summarizeValueArg(arg)}`.trim()
    case 'toHaveURL':
      return `URL deve casar com ${summarizeArgMaybeRegex(arg)}`
    case 'toHaveTitle':
      return `Título deve casar com ${summarizeArgMaybeRegex(arg)}`
    case 'toHaveCount':
      return `${subjectLabel} deve ter ${arg.trim()} ocorrências`
    default:
      return `Verificar ${matcher.replace(/^to/, '').toLowerCase()} em ${subjectLabel}`
  }
}

function summarizeArgMaybeRegex(arg: string): string {
  const regexMatch = arg.match(/^\/(.+)\/[gimsuy]*$/)
  if (regexMatch) return `/${regexMatch[1]}/`
  const stringMatch = arg.match(/^(['"`])([^'"`]*)\1/)
  if (stringMatch) return `"${stringMatch[2]}"`
  return arg.slice(0, 40)
}

function subjectFallback(subject: string): string | null {
  // page → null (cai em "URL/Título" nos casos específicos)
  if (/^page\s*$/.test(subject.trim())) return null
  // variável local: const dashboardLink → 'dashboardLink'
  const varMatch = subject.trim().match(/^(\w+)$/)
  if (varMatch) return varMatch[1]
  return null
}
