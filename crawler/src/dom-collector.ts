import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

import type { Project, SavedPageInput } from './db.ts'
import { decryptCredentials } from './crypto.ts'

const DATA_DIR = process.env.DATA_DIR ?? '/data'
const MAX_PAGES = Number(process.env.CRAWL_MAX_PAGES ?? 1000)
/**
 * Default usado apenas se o projeto não tiver `crawl_max_depth` configurado.
 * Em prod o valor vem do próprio projeto (configurável via UI).
 */
const DEFAULT_MAX_DEPTH = Number(process.env.CRAWL_MAX_DEPTH ?? 3)
const TOTAL_TIMEOUT_MS = Number(
  process.env.CRAWL_TOTAL_TIMEOUT_MS ?? 60 * 60_000,
)
const PAGE_TIMEOUT_MS = Number(process.env.CRAWL_PAGE_TIMEOUT_MS ?? 30_000)
const USER_AGENT =
  process.env.CRAWL_USER_AGENT ??
  'Mozilla/5.0 (k-veritas crawler) Playwright/1.49'

export interface CollectorCallbacks {
  onPage?: (input: SavedPageInput) => void | Promise<void>
  onProgress?: (info: { url: string; index: number; total: number }) => void | Promise<void>
}

export async function collectDom(
  project: Project,
  crawlId: string,
  callbacks: CollectorCallbacks = {},
): Promise<{ pagesCount: number }> {
  const baseUrl = new URL(project.target_url)
  const artifactsDir = join(DATA_DIR, 'projects', project.id, 'crawls', crawlId)
  await mkdir(artifactsDir, { recursive: true })

  const maxDepth =
    typeof project.crawl_max_depth === 'number' && project.crawl_max_depth > 0
      ? project.crawl_max_depth
      : DEFAULT_MAX_DEPTH

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const start = Date.now()
  let pagesCount = 0

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
    })

    if (project.auth_kind === 'form' && project.auth_credentials) {
      await performFormLogin(context, project.auth_credentials)
    }

    interface QueuedUrl {
      url: string
      depth: number
    }

    const queue: QueuedUrl[] = [{ url: project.target_url, depth: 0 }]
    const seen = new Set<string>()
    const enqueued = new Set<string>([project.target_url])

    console.log(
      `[crawler] starting crawl max_depth=${maxDepth} max_pages=${MAX_PAGES}`,
    )

    while (queue.length > 0 && pagesCount < MAX_PAGES) {
      if (Date.now() - start > TOTAL_TIMEOUT_MS) break

      const { url, depth } = queue.shift()!
      if (seen.has(url)) continue
      seen.add(url)

      console.log(
        `[crawler] ALLOW ${url} depth=${depth} reason=${depth === 0 ? 'seed_url' : 'within_limit'}`,
      )

      const page = await context.newPage()
      page.setDefaultTimeout(PAGE_TIMEOUT_MS)

      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page
          .waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT_MS })
          .catch(() => {})
        // Buffer extra para SPAs hidratarem após networkidle
        await page.waitForTimeout(1_500)
        // Espera ao menos um elemento interativo aparecer
        await page
          .waitForFunction(
            () =>
              document.body &&
              document.querySelectorAll(
                'button, a[href], input, textarea, select, [role="button"], [data-testid]',
              ).length > 0,
            undefined,
            { timeout: 5_000 },
          )
          .catch(() => {})

        const statusCode = response?.status() ?? null
        const title = await page.title().catch(() => null)
        const pageIndex = pagesCount + 1

        await callbacks.onProgress?.({ url, index: pageIndex, total: MAX_PAGES })

        const hash = hashUrl(url)
        const screenshotPath = join(artifactsDir, `page-${hash}.png`)
        const domPath = join(artifactsDir, `page-${hash}.html`)

        try {
          await page.screenshot({
            path: screenshotPath,
            fullPage: true,
            timeout: 15_000,
          })
        } catch {
          // seguir mesmo sem screenshot
        }

        const html = await page.content().catch(() => '')
        await writeFile(domPath, html, 'utf8')

        const elements = await extractElements(page)

        const saved: SavedPageInput = {
          url,
          title,
          statusCode,
          screenshotPath,
          domPath,
          elements,
        }

        // Diagnóstico: se extraiu 0 elementos mas a página claramente tem DOM,
        // logar um aviso com o tamanho do HTML pra facilitar debug
        if (elements.length === 0) {
          console.warn(
            `[crawler] ${url} extracted 0 elements (html length: ${html.length})`,
          )
        }

        await callbacks.onPage?.(saved)
        pagesCount++

        // Só segue links se o próximo depth estiver dentro do limite
        const nextDepth = depth + 1
        const links = await collectSameOriginLinks(page, baseUrl)

        for (const l of links) {
          if (seen.has(l) || enqueued.has(l)) continue

          if (nextDepth > maxDepth) {
            console.log(
              `[crawler] BLOCK ${l} depth=${nextDepth} reason=exceeds_max_depth (max=${maxDepth})`,
            )
            continue
          }

          enqueued.add(l)
          queue.push({ url: l, depth: nextDepth })
        }
      } catch (err) {
        // uma página com erro não interrompe o crawl
        console.error('[crawler] page failed', url, err)
      } finally {
        await page.close().catch(() => {})
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  return { pagesCount }
}

const USER_SELECTOR =
  'input[type="email"], input[name*="email" i], input[name*="user" i], input[name*="login" i], input[id*="email" i], input[id*="user" i], input[type="text"]:not([name*="search" i])'
const PASS_SELECTOR = 'input[type="password"]'
const SUBMIT_SELECTOR =
  'button[type="submit"], input[type="submit"], button:has-text("Entrar"), button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Acessar"), button:has-text("Enviar")'
const NEXT_SELECTOR =
  'button[type="submit"], button:has-text("Next"), button:has-text("Continue"), button:has-text("Continuar"), button:has-text("Próximo"), button:has-text("Proximo"), button:has-text("Avançar")'

async function performFormLogin(
  context: Awaited<ReturnType<Browser['newContext']>>,
  credentials: Buffer,
): Promise<void> {
  const creds = decryptCredentials(credentials)
  const page = await context.newPage()
  try {
    console.log(`[crawler] login: navegando para ${creds.loginUrl}`)
    await page.goto(creds.loginUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800) // buffer pra SPA hidratar

    const userInput = page.locator(USER_SELECTOR).first()
    const passInput = page.locator(PASS_SELECTOR).first()

    // Aguarda o campo de usuário aparecer
    await userInput.waitFor({ state: 'visible', timeout: 15_000 })
    await userInput.fill(creds.username)
    console.log('[crawler] login: usuário preenchido')

    // Detecta single-step vs two-step: o campo de senha já está visível agora?
    const passVisible = await passInput
      .isVisible({ timeout: 1_500 })
      .catch(() => false)

    if (passVisible) {
      console.log('[crawler] login: single-step detectado')
      await passInput.fill(creds.password)
      const submit = page.locator(SUBMIT_SELECTOR).first()
      await Promise.all([
        page
          .waitForLoadState('networkidle', { timeout: 20_000 })
          .catch(() => {}),
        submit.click().catch(() => {}),
      ])
    } else {
      console.log('[crawler] login: two-step detectado, clicando "next"')
      const nextBtn = page.locator(NEXT_SELECTOR).first()
      await nextBtn.click().catch(() => {})

      // Aguarda a tela de senha aparecer (pode ser navegação ou DOM update)
      await passInput
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => {
          console.warn(
            '[crawler] login: campo de senha não apareceu após clique em next',
          )
        })

      await passInput.fill(creds.password)
      console.log('[crawler] login: senha preenchida (step 2)')

      const finalSubmit = page.locator(SUBMIT_SELECTOR).first()
      await Promise.all([
        page
          .waitForLoadState('networkidle', { timeout: 20_000 })
          .catch(() => {}),
        finalSubmit.click().catch(() => {}),
      ])
    }

    // Um buffer final pra redirects pós-login completarem
    await page.waitForTimeout(1_200)
    console.log(`[crawler] login: finalizado (url atual: ${page.url()})`)
  } catch (err) {
    console.error('[crawler] login falhou:', err)
  } finally {
    await page.close().catch(() => {})
  }
}

async function collectSameOriginLinks(page: Page, base: URL): Promise<string[]> {
  const hrefs = await page
    .$$eval('a[href]', (anchors) =>
      (anchors as HTMLAnchorElement[]).map((a) => a.href),
    )
    .catch(() => [] as string[])

  const result: string[] = []
  for (const href of hrefs) {
    try {
      const u = new URL(href)
      if (u.host !== base.host) continue
      u.hash = ''
      // Normaliza trailing slash para evitar duplicar /foo e /foo/
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.replace(/\/+$/, '')
      }
      const normalized = u.toString()
      if (!result.includes(normalized)) result.push(normalized)
    } catch {
      // ignore
    }
  }
  return result
}

async function extractElements(
  page: Page,
): Promise<SavedPageInput['elements']> {
  const elements = await page.evaluate(() => {
    const out: Array<{
      kind: string
      role: string | null
      label: string | null
      selector: string
      meta: Record<string, unknown>
    }> = []

    const selectorFor = (el: Element): string => {
      const testId = el.getAttribute('data-testid')
      if (testId) return `[data-testid="${testId}"]`
      const id = el.id
      if (id && /^[a-zA-Z][\w-]*$/.test(id)) return `#${id}`
      const role = el.getAttribute('role')
      const name = el.getAttribute('aria-label') || (el as HTMLElement).innerText?.trim().slice(0, 40)
      if (role && name) return `role=${role}[name="${name.replace(/"/g, '\\"')}"]`
      return el.tagName.toLowerCase()
    }

    const visibleText = (el: Element): string => {
      const txt = (el as HTMLElement).innerText?.trim() ?? ''
      return txt.slice(0, 120)
    }

    // Headings
    document.querySelectorAll('h1, h2, h3').forEach((h) => {
      out.push({
        kind: 'heading',
        role: h.getAttribute('role') ?? h.tagName.toLowerCase(),
        label: visibleText(h),
        selector: selectorFor(h),
        meta: { level: h.tagName.toLowerCase() },
      })
    })

    // Buttons
    document
      .querySelectorAll('button, [role="button"]')
      .forEach((b) => {
        out.push({
          kind: 'button',
          role: b.getAttribute('role') ?? 'button',
          label: b.getAttribute('aria-label') || visibleText(b),
          selector: selectorFor(b),
          meta: {},
        })
      })

    // Links
    document.querySelectorAll('a[href]').forEach((a) => {
      out.push({
        kind: 'link',
        role: 'link',
        label: visibleText(a) || (a as HTMLAnchorElement).href,
        selector: selectorFor(a),
        meta: { href: (a as HTMLAnchorElement).href },
      })
    })

    // Inputs
    document
      .querySelectorAll('input, textarea, select')
      .forEach((i) => {
        const el = i as HTMLInputElement
        out.push({
          kind: 'input',
          role: el.getAttribute('role'),
          label:
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.name ||
            null,
          selector: selectorFor(el),
          meta: { type: el.type, name: el.name, required: el.required },
        })
      })

    // Forms
    document.querySelectorAll('form').forEach((f) => {
      out.push({
        kind: 'form',
        role: 'form',
        label: f.getAttribute('aria-label') || f.getAttribute('name') || null,
        selector: selectorFor(f),
        meta: {
          action: (f as HTMLFormElement).action,
          method: (f as HTMLFormElement).method,
        },
      })
    })

    // Navs
    document.querySelectorAll('nav').forEach((n) => {
      out.push({
        kind: 'nav',
        role: 'navigation',
        label: n.getAttribute('aria-label') || null,
        selector: selectorFor(n),
        meta: {},
      })
    })

    // Elementos com role ARIA explícito (tabs, dialog, menu, etc)
    document
      .querySelectorAll(
        '[role="tab"], [role="tabpanel"], [role="dialog"], [role="alert"], [role="menu"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="listbox"], [role="option"]',
      )
      .forEach((el) => {
        out.push({
          kind: 'aria',
          role: el.getAttribute('role'),
          label: el.getAttribute('aria-label') || visibleText(el) || null,
          selector: selectorFor(el),
          meta: {},
        })
      })

    // Qualquer elemento com data-testid (teste-friendly)
    document.querySelectorAll('[data-testid]').forEach((el) => {
      out.push({
        kind: 'testid',
        role: el.getAttribute('role'),
        label:
          el.getAttribute('aria-label') ||
          visibleText(el) ||
          el.getAttribute('data-testid'),
        selector: `[data-testid="${el.getAttribute('data-testid')}"]`,
        meta: { testid: el.getAttribute('data-testid') },
      })
    })

    // Labels (para associação com inputs)
    document.querySelectorAll('label').forEach((l) => {
      out.push({
        kind: 'label',
        role: 'label',
        label: visibleText(l),
        selector: selectorFor(l),
        meta: { for: (l as HTMLLabelElement).htmlFor },
      })
    })

    // Imagens com alt (candidatas a asserções)
    document.querySelectorAll('img[alt]').forEach((img) => {
      const alt = img.getAttribute('alt')
      if (!alt) return
      out.push({
        kind: 'image',
        role: 'img',
        label: alt,
        selector: selectorFor(img),
        meta: { src: (img as HTMLImageElement).src },
      })
    })

    // Dedup grosseiro por selector
    const seen = new Set<string>()
    const deduped = out.filter((el) => {
      const key = `${el.kind}:${el.selector}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return deduped.slice(0, 1000)
  })

  return elements
}

function hashUrl(url: string): string {
  // FNV-1a simples (32 bits) para hash estável sem deps
  let h = 0x811c9dc5
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
