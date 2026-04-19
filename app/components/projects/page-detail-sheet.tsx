'use client'

import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FormInput,
  Heading1,
  Image as ImageIcon,
  Layers,
  Link as LinkIcon,
  Loader2,
  MousePointerClick,
  Navigation,
  Tag,
  TextCursor,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface ElementRow {
  id: string
  kind: string
  role: string | null
  label: string | null
  selector: string
  meta: Record<string, unknown>
}

interface PageInfo {
  id: string
  url: string
  title: string | null
  statusCode: number | null
  discoveredAt: string
}

interface Payload {
  page: PageInfo
  elements: ElementRow[]
}

interface PageDetailSheetProps {
  projectId: string
  pageId: string | null
  onClose: () => void
}

const KIND_ICONS: Record<string, LucideIcon> = {
  button: MousePointerClick,
  link: LinkIcon,
  input: TextCursor,
  form: FormInput,
  heading: Heading1,
  nav: Navigation,
  aria: Layers,
  testid: Tag,
  label: Tag,
  image: ImageIcon,
}

export function PageDetailSheet({
  projectId,
  pageId,
  onClose,
}: PageDetailSheetProps) {
  const t = useTranslations('projects.overview.page_detail')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    if (!pageId) return
    let cancelled = false
    setLoading(true)
    setData(null)
    setFilter('all')
    fetch(`/api/projects/${projectId}/pages/${pageId}/elements`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: Payload | null) => {
        if (cancelled) return
        setData(payload)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, pageId])

  const open = pageId !== null
  const elements = data?.elements ?? []

  const kindCounts = elements.reduce<Record<string, number>>((acc, el) => {
    acc[el.kind] = (acc[el.kind] ?? 0) + 1
    return acc
  }, {})

  const visible =
    filter === 'all'
      ? elements
      : elements.filter((el) => el.kind === filter)

  const hasError = (data?.page.statusCode ?? 0) >= 400

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 border-b border-border p-5">
          {data?.page ? (
            <>
              <SheetTitle className="flex items-center gap-2 font-mono text-base">
                <span className="truncate">{pathOf(data.page.url)}</span>
                <a
                  href={data.page.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground/60 hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                {data.page.title ? (
                  <span className="truncate">{data.page.title}</span>
                ) : null}
                {data.page.statusCode ? (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium',
                      hasError
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {hasError ? <AlertTriangle className="size-3" /> : null}
                    {data.page.statusCode}
                  </span>
                ) : null}
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground tabular-nums">
                  {elements.length} {t('elements')}
                </span>
              </SheetDescription>
            </>
          ) : (
            <>
              <SheetTitle>{t('loading')}</SheetTitle>
              <SheetDescription />
            </>
          )}
          <SheetClose className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-4" />
            <span className="sr-only">{t('close')}</span>
          </SheetClose>
        </SheetHeader>

        {/* Filtros por kind */}
        {elements.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3">
            <KindChip
              active={filter === 'all'}
              count={elements.length}
              label={t('kinds.all')}
              onClick={() => setFilter('all')}
            />
            {Object.entries(kindCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([kind, count]) => (
                <KindChip
                  key={kind}
                  active={filter === kind}
                  kind={kind}
                  count={count}
                  label={kindLabel(t, kind)}
                  onClick={() => setFilter(kind)}
                />
              ))}
          </div>
        ) : null}

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {visible.map((el) => (
                <ElementItem key={el.id} element={el} />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function KindChip({
  active,
  kind,
  count,
  label,
  onClick,
}: {
  active: boolean
  kind?: string
  count: number
  label: string
  onClick: () => void
}) {
  const Icon = kind ? (KIND_ICONS[kind] ?? Tag) : Layers
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-3" />
      <span>{label}</span>
      <span
        className={cn(
          'rounded px-1 font-mono text-[10px] tabular-nums',
          active ? 'bg-primary-foreground/20' : 'bg-muted',
        )}
      >
        {count}
      </span>
    </button>
  )
}

function ElementItem({ element }: { element: ElementRow }) {
  const t = useTranslations('projects.overview.page_detail')
  const [copied, setCopied] = useState(false)
  const Icon = KIND_ICONS[element.kind] ?? Tag

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(element.selector)
      setCopied(true)
      toast.success(t('copied'))
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('copy_error'))
    }
  }

  return (
    <li className="group rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/5 text-primary">
          <Icon className="size-3.5" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {element.kind}
            </span>
            {element.role ? (
              <span className="rounded bg-muted px-1 py-0 text-[10px] font-mono text-muted-foreground">
                {element.role}
              </span>
            ) : null}
          </div>
          {element.label ? (
            <p className="truncate text-sm font-medium" title={element.label}>
              {element.label}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              {t('no_label')}
            </p>
          )}
          <code
            className="block truncate rounded bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground"
            title={element.selector}
          >
            {element.selector}
          </code>
        </div>

        <button
          type="button"
          onClick={copy}
          aria-label={t('copy')}
          title={t('copy')}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3.5 text-fin-gain" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
    </li>
  )
}

function pathOf(url: string): string {
  try {
    const u = new URL(url)
    const p = u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '')
    return p + u.search
  } catch {
    return url
  }
}

const KNOWN_KINDS = new Set([
  'button',
  'link',
  'input',
  'form',
  'heading',
  'nav',
  'aria',
  'testid',
  'label',
  'image',
])

function kindLabel(
  t: (key: string) => string,
  kind: string,
): string {
  if (KNOWN_KINDS.has(kind)) {
    return t(`kinds.${kind}`)
  }
  return kind
}
