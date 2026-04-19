import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

import type { Project, SavedPageInput } from './db.ts'
import { decryptCredentials } from './crypto.ts'

const DATA_DIR = process.env.DATA_DIR ?? '/data'
const MAX_PAGES = Number(process.env.CRAWL_MAX_PAGES ?? 20)
const TOTAL_TIMEOUT_MS = Number(process.env.CRAWL_TOTAL_TIMEOUT_MS ?? 5 * 60_000)
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

    const queue: string[] = [project.target_url]
    const seen = new Set<string>()

    while (queue.length > 0 && pagesCount < MAX_PAGES) {
      if (Date.now() - start > TOTAL_TIMEOUT_MS) break

      const url = queue.shift()!
      if (seen.has(url)) continue
      seen.add(url)

      const page = await context.newPage()
      page.setDefaultTimeout(PAGE_TIMEOUT_MS)

      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT_MS }).catch(() => {})

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
        await callbacks.onPage?.(saved)
        pagesCount++

        const links = await collectSameOriginLinks(page, baseUrl)
        for (const l of links) {
          if (!seen.has(l) && !queue.includes(l)) queue.push(l)
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

async function performFormLogin(
  context: Awaited<ReturnType<Browser['newContext']>>,
  credentials: Buffer,
): Promise<void> {
  const creds = decryptCredentials(credentials)
  const page = await context.newPage()
  try {
    await page.goto(creds.loginUrl, { waitUntil: 'domcontentloaded' })

    const user = await page
      .locator('input[type="email"], input[name*="email" i], input[name*="user" i], input[type="text"]')
      .first()
    const pass = await page.locator('input[type="password"]').first()
    const submit = await page
      .locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login"), button:has-text("Sign in")')
      .first()

    await user.fill(creds.username)
    await pass.fill(creds.password)
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      submit.click().catch(() => {}),
    ])
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

    return out.slice(0, 500)
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
