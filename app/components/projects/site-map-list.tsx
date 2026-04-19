'use client'

import { FileSearch, Globe } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Skeleton } from '@/components/ui/skeleton'
import { CrawlLogStream } from './crawl-log-stream'

interface Page {
  id: string
  url: string
  title: string | null
  statusCode: number | null
  elementsCount: number
  discoveredAt: string
}

interface SiteMapListProps {
  projectId: string
  status: string
}

export function SiteMapList({ projectId, status }: SiteMapListProps) {
  const t = useTranslations('projects.overview.map')
  const [pages, setPages] = useState<Page[] | null>(null)
  const [loading, setLoading] = useState(true)

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
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16" />
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

  return (
    <ul className="space-y-2">
      {pages?.map((p) => (
        <li
          key={p.id}
          className="flex items-center gap-4 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/30"
        >
          <div className="relative size-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
            <img
              src={`/api/projects/${projectId}/pages/${p.id}/screenshot`}
              alt=""
              loading="lazy"
              className="size-full object-cover object-top"
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
            <Globe className="absolute inset-0 m-auto size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {p.title || stripUrl(p.url)}
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {p.url}
            </p>
          </div>
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            <div className="tabular-nums">
              {p.elementsCount} {t('elements')}
            </div>
            {p.statusCode ? (
              <div className="mt-0.5 font-mono text-[10px]">
                HTTP {p.statusCode}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

function stripUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return u.pathname === '/' ? u.hostname : u.pathname
  } catch {
    return raw
  }
}
