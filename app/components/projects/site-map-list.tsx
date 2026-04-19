'use client'

import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  FileSearch,
  FileText,
  FileX,
  Folder,
  Home,
  LayoutDashboard,
  List,
  Loader2,
  Lock,
  LogIn,
  Network,
  Plug,
  RotateCw,
  Settings as SettingsIcon,
  ShieldAlert,
  User,
  type LucideIcon,
} from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { CrawlLogStream } from './crawl-log-stream'
import { PageDetailSheet } from './page-detail-sheet'
import { SiteTree, type TreePage } from './site-tree'

interface Page {
  id: string
  url: string
  title: string | null
  statusCode: number | null
  elementsCount: number
  discoveredAt: string
}

type ViewMode = 'list' | 'tree'

interface SiteMapListProps {
  projectId: string
  status: string
}

export function SiteMapList({ projectId, status }: SiteMapListProps) {
  const t = useTranslations('projects.overview.map')
  const [pages, setPages] = useState<Page[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>('tree')
  const [activePageId, setActivePageId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/pages`, {
        headers: { 'X-Requested-With': 'fetch' },
      })
      if (!res.ok) return
      const data = (await res.json()) as { items: Page[] }
      setPages(data.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, status])

  useEffect(() => {
    const saved = localStorage.getItem('kv:sitemap-view')
    if (saved === 'list' || saved === 'tree') setView(saved)
  }, [])

  const switchView = (mode: ViewMode) => {
    setView(mode)
    localStorage.setItem('kv:sitemap-view', mode)
  }

  if (status === 'crawling') {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="font-display text-base font-semibold">
            {t('crawling_title')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('crawling_description')}
          </p>
        </div>
        <CrawlLogStream projectId={projectId} onComplete={load} />
      </div>
    )
  }

  if (loading && pages === null) {
    return (
      <div className="space-y-1.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    )
  }

  if (pages && pages.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center">
        <FileSearch className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t('empty_title')}</p>
        <p className="text-xs text-muted-foreground">{t('empty_description')}</p>
      </div>
    )
  }

  const normalized = pages ?? []
  const totalElements = normalized.reduce((sum, p) => sum + p.elementsCount, 0)
  const emptyPages = normalized.filter((p) => p.elementsCount === 0).length
  const groups = groupByHost(normalized)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground tabular-nums">
              {normalized.length}
            </strong>{' '}
            {t('summary.pages')}
          </span>
          <span className="opacity-40">·</span>
          <span>
            <strong className="text-foreground tabular-nums">
              {totalElements}
            </strong>{' '}
            {t('summary.elements')}
          </span>
          {emptyPages > 0 ? (
            <>
              <span className="opacity-40">·</span>
              <span className="inline-flex items-center gap-1 text-amber-500">
                <AlertCircle className="size-3" />
                {t('summary.empty_pages', { count: emptyPages })}
              </span>
            </>
          ) : null}
        </div>

        <div className="inline-flex rounded-md border border-border bg-secondary/50 p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => switchView('tree')}
            aria-pressed={view === 'tree'}
            className={cn(
              'inline-flex items-center gap-1 rounded-[4px] px-2 py-1 transition-colors',
              view === 'tree'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Network className="size-3.5" />
            {t('view.tree')}
          </button>
          <button
            type="button"
            onClick={() => switchView('list')}
            aria-pressed={view === 'list'}
            className={cn(
              'inline-flex items-center gap-1 rounded-[4px] px-2 py-1 transition-colors',
              view === 'list'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <List className="size-3.5" />
            {t('view.list')}
          </button>
        </div>
      </div>

      {view === 'tree' ? (
        <div className="space-y-3">
          {groups.map((group) => (
            <SiteTree
              key={group.host}
              host={group.host}
              pages={group.pages}
              iconForPath={iconForPath}
              projectId={projectId}
              onUpdated={load}
              onOpenPage={setActivePageId}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <HostGroup
              key={group.host}
              group={group}
              projectId={projectId}
              onUpdated={load}
              onOpenPage={setActivePageId}
            />
          ))}
        </div>
      )}

      <PageDetailSheet
        projectId={projectId}
        pageId={activePageId}
        onClose={() => setActivePageId(null)}
      />
    </div>
  )
}

interface HostGroupData {
  host: string
  pages: Array<TreePage>
  totalElements: number
}

function HostGroup({
  group,
  projectId,
  onUpdated,
  onOpenPage,
}: {
  group: HostGroupData
  projectId: string
  onUpdated?: () => void
  onOpenPage?: (pageId: string) => void
}) {
  const t = useTranslations('projects.overview.map')
  const [open, setOpen] = useState(true)

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-accent/30"
      >
        <ChevronRight
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm font-medium">
              {group.host}
            </span>
            <a
              href={`https://${group.host}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground/60 hover:text-foreground"
              aria-label="Abrir em nova aba"
            >
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {group.pages.length} {t('summary.pages')}
        </span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
          {group.totalElements} el
        </span>
      </button>

      {open ? (
        <ul className="divide-y divide-border/40">
          {group.pages.map((p) => (
            <PageRow
              key={p.id}
              projectId={projectId}
              page={p}
              onUpdated={onUpdated}
              onOpenPage={onOpenPage}
            />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function PageRow({
  projectId,
  page,
  onUpdated,
  onOpenPage,
}: {
  projectId: string
  page: TreePage
  onUpdated?: () => void
  onOpenPage?: (pageId: string) => void
}) {
  const t = useTranslations('projects.overview.map')
  const Icon = iconForPath(page.path, { statusCode: page.statusCode })
  const hasElements = page.elementsCount > 0
  const hasError = (page.statusCode ?? 0) >= 400

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/30">
      <button
        type="button"
        onClick={() => onOpenPage?.(page.id)}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors',
          hasError
            ? 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20'
            : hasElements
              ? 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
              : 'border-amber-500/20 bg-amber-500/5 text-amber-500 hover:bg-amber-500/10',
        )}
        aria-label={t('row.open_detail')}
      >
        <Icon className="size-4" />
      </button>

      <button
        type="button"
        onClick={() => onOpenPage?.(page.id)}
        className="min-w-0 flex-1 space-y-0.5 text-left"
      >
        <div className="truncate font-mono text-sm font-semibold leading-tight group-hover:underline">
          {page.path}
        </div>
        {page.title ? (
          <p className="truncate text-xs text-muted-foreground">{page.title}</p>
        ) : null}
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        <Badge
          tone={hasElements ? 'neutral' : 'warning'}
          title={hasElements ? undefined : t('row.no_elements_hint')}
        >
          <span className="tabular-nums">{page.elementsCount}</span>
          <span className="opacity-60">el</span>
        </Badge>
        {page.statusCode ? (
          <Badge tone={page.statusCode < 400 ? 'neutral' : 'error'}>
            <span className="font-mono tabular-nums">{page.statusCode}</span>
          </Badge>
        ) : null}
        {hasError ? (
          <RecheckButton
            projectId={projectId}
            pageId={page.id}
            onUpdated={onUpdated}
          />
        ) : null}
      </div>
    </li>
  )
}

function RecheckButton({
  projectId,
  pageId,
  onUpdated,
}: {
  projectId: string
  pageId: string
  onUpdated?: () => void
}) {
  const t = useTranslations('projects.overview.map.recheck')
  const [pending, start] = useTransition()

  const doRecheck = (e: React.MouseEvent) => {
    e.stopPropagation()
    start(async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/pages/${pageId}/recheck`,
          { method: 'POST', headers: { 'X-Requested-With': 'fetch' } },
        )
        if (!res.ok) {
          toast.error(t('errors.generic'))
          return
        }
        const data = (await res.json()) as { statusCode: number | null }
        if (data.statusCode !== null && data.statusCode < 400) {
          toast.success(t('success', { status: String(data.statusCode) }))
        } else {
          toast.warning(
            t('still_failing', {
              status: String(data.statusCode ?? '—'),
            }),
          )
        }
        onUpdated?.()
      } catch {
        toast.error(t('errors.network'))
      }
    })
  }

  return (
    <button
      type="button"
      onClick={doRecheck}
      disabled={pending}
      title={t('label')}
      className={cn(
        'inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground',
        'disabled:opacity-60',
      )}
      aria-label={t('label')}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RotateCw className="size-3.5" />
      )}
    </button>
  )
}

function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'warning' | 'error'
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        tone === 'warning' && 'bg-amber-500/15 text-amber-500',
        tone === 'error' && 'bg-destructive/15 text-destructive',
      )}
    >
      {children}
    </span>
  )
}

// ───────────────────────────────────────────────────────────

function groupByHost(pages: Page[]): HostGroupData[] {
  const map = new Map<string, HostGroupData>()
  for (const p of pages) {
    const { host, path } = splitUrl(p.url)
    const key = host || 'unknown'
    const treePage: TreePage = { ...p, path }
    const existing = map.get(key)
    if (existing) {
      existing.pages.push(treePage)
      existing.totalElements += p.elementsCount
    } else {
      map.set(key, {
        host: key,
        pages: [treePage],
        totalElements: p.elementsCount,
      })
    }
  }
  return Array.from(map.values()).map((g) => ({
    ...g,
    pages: g.pages.sort((a, b) => a.path.localeCompare(b.path)),
  }))
}

function splitUrl(raw: string): { host: string; path: string } {
  try {
    const u = new URL(raw)
    const pathname =
      u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '')
    return { host: u.hostname, path: pathname + u.search }
  } catch {
    return { host: '', path: raw }
  }
}

/**
 * Escolhe ícone semântico com a seguinte prioridade:
 * 1. Status HTTP (erro tem prioridade absoluta)
 * 2. Root / (sempre Home)
 * 3. Nó inferido sem page (Folder)
 * 4. Keywords universais web (login, auth, settings, admin, api, dashboard)
 * 5. Fallback: FileText
 *
 * Não mapeamos domínios de negócio (obra, broker, fornecedor...) porque
 * varia entre clientes. Ícones baseados em estado/convenção web são mais robustos.
 */
function iconForPath(
  path: string,
  context?: { statusCode?: number | null; isDirectory?: boolean; inferred?: boolean },
): LucideIcon {
  const status = context?.statusCode ?? null
  if (status !== null) {
    if (status === 401 || status === 403) return Lock
    if (status === 404) return FileX
    if (status >= 500) return ShieldAlert
    if (status >= 400) return AlertTriangle
  }

  if (context?.inferred) return Folder

  const p = path.toLowerCase()
  if (p === '/' || p === '' || p === '/home' || p === '/index') return Home

  if (/(^|\/)(login|signin|sign-in|auth|register|signup|sign-up)(\/|$)/.test(p))
    return LogIn
  if (/(^|\/)(me|profile|account)(\/|$)/.test(p)) return User
  if (/(^|\/)(settings?|config|preferences?|admin)(\/|$)/.test(p))
    return SettingsIcon
  if (/(^|\/)(dashboard|overview)(\/|$)/.test(p)) return LayoutDashboard
  if (/(^|\/)(api|v\d+|graphql)(\/|$)/.test(p)) return Plug

  return FileText
}
