'use client'

import { ChevronRight, Home, Loader2, RotateCw, type LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { RecrawlPathButton } from './recrawl-path-button'

export interface TreePage {
  id: string
  url: string
  title: string | null
  statusCode: number | null
  redirectedTo: string | null
  elementsCount: number
  path: string
}

interface TreeNode {
  segment: string
  fullPath: string
  page: TreePage | null
  children: TreeNode[]
}

type IconResolver = (
  path: string,
  context?: {
    statusCode?: number | null
    isDirectory?: boolean
    inferred?: boolean
  },
) => LucideIcon

export function SiteTree({
  host,
  pages,
  iconForPath,
  projectId,
  onUpdated,
  onOpenPage,
}: {
  host: string
  pages: TreePage[]
  iconForPath: IconResolver
  projectId: string
  onUpdated?: () => void
  onOpenPage?: (pageId: string) => void
}) {
  const root = buildTree(pages)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (fullPath: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(fullPath)) next.delete(fullPath)
      else next.add(fullPath)
      return next
    })
  }

  const isCollapsed = (fullPath: string) => collapsed.has(fullPath)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card p-2">
      <TreeBranch
        node={root}
        depth={0}
        iconForPath={iconForPath}
        isRoot
        rootLabel={host}
        isCollapsed={isCollapsed}
        toggle={toggle}
        projectId={projectId}
        onUpdated={onUpdated}
        onOpenPage={onOpenPage}
      />
    </div>
  )
}

function TreeBranch({
  node,
  depth,
  iconForPath,
  isRoot = false,
  rootLabel,
  isCollapsed,
  toggle,
  projectId,
  onUpdated,
  onOpenPage,
}: {
  node: TreeNode
  depth: number
  iconForPath: IconResolver
  isRoot?: boolean
  rootLabel?: string
  isCollapsed: (fullPath: string) => boolean
  toggle: (fullPath: string) => void
  projectId: string
  onUpdated?: () => void
  onOpenPage?: (pageId: string) => void
}) {
  const collapsed = isCollapsed(node.fullPath)

  return (
    <>
      <TreeRow
        node={node}
        depth={depth}
        iconForPath={iconForPath}
        isRoot={isRoot}
        rootLabel={rootLabel}
        collapsed={collapsed}
        onToggle={() => toggle(node.fullPath)}
        projectId={projectId}
        onUpdated={onUpdated}
        onOpenPage={onOpenPage}
      />

      {node.children.length > 0 && !collapsed ? (
        <div className="relative ml-[14px] border-l border-dashed border-border/60">
          {node.children.map((child) => (
            <TreeBranch
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              iconForPath={iconForPath}
              isCollapsed={isCollapsed}
              toggle={toggle}
              projectId={projectId}
              onUpdated={onUpdated}
              onOpenPage={onOpenPage}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}

function TreeRow({
  node,
  depth,
  iconForPath,
  isRoot,
  rootLabel,
  collapsed,
  onToggle,
  projectId,
  onUpdated,
  onOpenPage,
}: {
  node: TreeNode
  depth: number
  iconForPath: IconResolver
  isRoot: boolean
  rootLabel?: string
  collapsed: boolean
  onToggle: () => void
  projectId: string
  onUpdated?: () => void
  onOpenPage?: (pageId: string) => void
}) {
  const t = useTranslations('projects.overview.map')
  const hasChildren = node.children.length > 0
  const Icon: LucideIcon = node.page
    ? iconForPath(node.page.path, { statusCode: node.page.statusCode })
    : node.fullPath === '/'
      ? Home
      : iconForPath(node.fullPath, {
          isDirectory: hasChildren,
          inferred: true,
        })

  const hasElements = (node.page?.elementsCount ?? 0) > 0
  const inferred = !node.page
  const hasError = (node.page?.statusCode ?? 0) >= 400

  return (
    <div
      className="group relative flex items-center gap-2 rounded-md py-1 pr-2 transition-colors hover:bg-accent/30"
      style={{ paddingLeft: depth > 0 ? 20 : 8 }}
    >
      {depth > 0 ? (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-px w-[14px] border-t border-dashed border-border/60"
        />
      ) : null}

      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('tree.expand') : t('tree.collapse')}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              'size-3.5 transition-transform',
              !collapsed && 'rotate-90',
            )}
          />
        </button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden />
      )}

      {node.page && onOpenPage ? (
        <button
          type="button"
          onClick={() => onOpenPage(node.page!.id)}
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors',
            hasError
              ? 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20'
              : hasElements
                ? 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
                : 'border-amber-500/20 bg-amber-500/5 text-amber-500 hover:bg-amber-500/10',
          )}
          aria-label="Ver detalhes"
        >
          <Icon className="size-3.5" />
        </button>
      ) : (
        <div
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border',
            inferred
              ? 'border-border/40 bg-muted/40 text-muted-foreground'
              : hasError
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : hasElements
                  ? 'border-primary/20 bg-primary/5 text-primary'
                  : 'border-amber-500/20 bg-amber-500/5 text-amber-500',
          )}
        >
          <Icon className="size-3.5" />
        </div>
      )}

      {node.page && onOpenPage ? (
        <button
          type="button"
          onClick={() => onOpenPage(node.page!.id)}
          className="min-w-0 flex-1 space-y-0.5 text-left"
        >
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'truncate font-mono text-sm font-medium leading-tight hover:underline',
                inferred && 'italic text-muted-foreground',
              )}
            >
              {isRoot && rootLabel
                ? rootLabel
                : isRoot
                  ? '/'
                  : lastSegment(node.fullPath)}
            </span>
            {hasChildren ? (
              <span
                className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium leading-[14px] tabular-nums text-muted-foreground"
                title={t('tree.children_count', { count: node.children.length })}
              >
                {node.children.length}
              </span>
            ) : null}
          </div>
          {node.page.title ? (
            <p className="truncate text-xs text-muted-foreground">
              {node.page.title}
            </p>
          ) : null}
        </button>
      ) : (
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'truncate font-mono text-sm font-medium leading-tight',
                inferred && 'italic text-muted-foreground',
              )}
            >
              {isRoot && rootLabel
                ? rootLabel
                : isRoot
                  ? '/'
                  : lastSegment(node.fullPath)}
            </span>
            {hasChildren ? (
              <span
                className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium leading-[14px] tabular-nums text-muted-foreground"
                title={t('tree.children_count', { count: node.children.length })}
              >
                {node.children.length}
              </span>
            ) : null}
            {inferred ? (
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {t('tree.inferred')}
              </span>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        {node.page ? (
          <>
            {node.page.redirectedTo ? (
              <Badge tone="warning" title={node.page.redirectedTo}>
                <span>↪</span>
                <span className="font-mono">
                  {shortPath(node.page.redirectedTo)}
                </span>
              </Badge>
            ) : (
              <Badge tone={hasElements ? 'neutral' : 'warning'}>
                <span className="tabular-nums">{node.page.elementsCount}</span>
                <span className="opacity-60">el</span>
              </Badge>
            )}
            {node.page.statusCode ? (
              <Badge tone={node.page.statusCode < 400 ? 'neutral' : 'error'}>
                <span className="font-mono tabular-nums">
                  {node.page.statusCode}
                </span>
              </Badge>
            ) : null}
            <RecrawlPathButton
              projectId={projectId}
              url={node.page.url}
              onUpdated={onUpdated}
            />
            {hasError ? (
              <RecheckButton
                projectId={projectId}
                pageId={node.page.id}
                onUpdated={onUpdated}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
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
          {
            method: 'POST',
            headers: { 'X-Requested-With': 'fetch' },
          },
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
            t('still_failing', { status: String(data.statusCode ?? '—') }),
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
      aria-label={t('label')}
      className={cn(
        'inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground',
        'disabled:opacity-60',
      )}
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
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'warning' | 'error'
}) {
  return (
    <span
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

function lastSegment(path: string): string {
  if (path === '/' || path === '') return '/'
  const parts = path.split('/').filter(Boolean)
  return '/' + (parts[parts.length - 1] ?? '')
}

function shortPath(raw: string): string {
  try {
    const u = new URL(raw)
    return u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '')
  } catch {
    return raw
  }
}

function buildTree(pages: TreePage[]): TreeNode {
  const root: TreeNode = {
    segment: '/',
    fullPath: '/',
    page: null,
    children: [],
  }

  const sorted = [...pages].sort((a, b) => a.path.localeCompare(b.path))

  for (const page of sorted) {
    if (page.path === '/') {
      root.page = page
      continue
    }
    const segments = page.path.split('/').filter(Boolean)
    let current = root
    let pathSoFar = ''
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!
      pathSoFar += '/' + seg
      let next = current.children.find((c) => c.fullPath === pathSoFar)
      if (!next) {
        next = {
          segment: '/' + seg,
          fullPath: pathSoFar,
          page: null,
          children: [],
        }
        current.children.push(next)
      }
      if (i === segments.length - 1) {
        next.page = page
      }
      current = next
    }
  }

  sortTree(root)
  return root
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    const aHasChildren = a.children.length > 0
    const bHasChildren = b.children.length > 0
    if (aHasChildren !== bHasChildren) return aHasChildren ? -1 : 1
    return a.fullPath.localeCompare(b.fullPath)
  })
  node.children.forEach(sortTree)
}
