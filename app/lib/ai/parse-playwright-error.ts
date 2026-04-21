/**
 * Parser da mensagem de erro do Playwright para extrair informação
 * estruturada (categoria, locator alvo, timeout em ms). Puro e defensivo:
 * qualquer falha vira categoria 'unknown', o texto original fica preservado.
 */

export type PlaywrightErrorCategory =
  | 'timeout'
  | 'assertion'
  | 'navigation'
  | 'locator'
  | 'target_closed'
  | 'network'
  | 'unknown'

export interface ParsedPlaywrightError {
  category: PlaywrightErrorCategory
  /** Selector em texto (ex.: `getByRole('button', { name: /entrar/i })`). */
  locator: string | null
  /** Timeout reportado na mensagem, em ms. */
  timeoutMs: number | null
  /** Nome do erro (ex.: `TimeoutError`). */
  name: string | null
  /** Primeira linha relevante, já limpa do prefixo `Error: `. */
  summary: string
}

const LOCATOR_PATTERNS = [
  /waiting for (.+?)(?:\s|$)/i,
  /locator\(['"](.+?)['"]\)/,
]

const TIMEOUT_PATTERNS = [
  /Timeout\s+(\d+)\s*ms/i,
  /exceeded\.\s*Call log:/i,
]

export function parsePlaywrightError(
  message: string | null | undefined,
): ParsedPlaywrightError {
  const raw = (message ?? '').trim()
  if (!raw) {
    return {
      category: 'unknown',
      locator: null,
      timeoutMs: null,
      name: null,
      summary: '',
    }
  }

  const summary = firstMeaningfulLine(raw)
  const name = extractName(raw)
  const category = categorize(raw, name)
  const locator = extractLocator(raw)
  const timeoutMs = extractTimeout(raw)

  return { category, locator, timeoutMs, name, summary }
}

function firstMeaningfulLine(raw: string): string {
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^Call log:/i.test(trimmed)) break
    return trimmed.replace(/^Error:\s*/i, '')
  }
  return raw.split(/\r?\n/)[0]?.trim() ?? raw
}

function extractName(raw: string): string | null {
  const m = raw.match(/^([A-Z][A-Za-z]*Error)\s*[:]/)
  return m ? m[1] : null
}

function categorize(
  raw: string,
  name: string | null,
): PlaywrightErrorCategory {
  if (name === 'TimeoutError' || /Timeout\s+\d+\s*ms/i.test(raw)) {
    return 'timeout'
  }
  if (/expect\(.+\)/.test(raw) || /Expected.*Received/.test(raw)) {
    return 'assertion'
  }
  if (/navigat\w+/i.test(raw) || /page\.goto/i.test(raw)) {
    return 'navigation'
  }
  if (/strict mode violation/i.test(raw) || /locator\.resolve/i.test(raw)) {
    return 'locator'
  }
  if (/Target page.*closed|Browser has been closed/i.test(raw)) {
    return 'target_closed'
  }
  if (/ERR_CONNECTION|net::ERR|ENOTFOUND|ECONNREFUSED/i.test(raw)) {
    return 'network'
  }
  return 'unknown'
}

function extractLocator(raw: string): string | null {
  for (const pattern of LOCATOR_PATTERNS) {
    const m = raw.match(pattern)
    if (m && m[1]) {
      return m[1].trim().replace(/\s+/g, ' ').slice(0, 200)
    }
  }
  return null
}

function extractTimeout(raw: string): number | null {
  for (const pattern of TIMEOUT_PATTERNS) {
    const m = raw.match(pattern)
    if (m && m[1]) {
      const n = Number(m[1])
      if (Number.isFinite(n)) return n
    }
  }
  return null
}
