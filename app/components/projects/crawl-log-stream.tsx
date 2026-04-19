'use client'

import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

interface LogEvent {
  id: string
  level: 'info' | 'success' | 'error' | 'progress'
  message: string
  timestamp: Date
}

interface CrawlPageLite {
  id: string
  url: string
  title: string | null
  statusCode: number | null
  elementsCount: number
  discoveredAt: string
}

interface CrawlSnapshot {
  crawl: {
    id: string
    status: string
    pagesCount: number
    error: string | null
    createdAt: string
    startedAt: string | null
    finishedAt: string | null
  } | null
  pages: CrawlPageLite[]
}

interface CrawlLogStreamProps {
  projectId: string
  onComplete?: () => void
}

export function CrawlLogStream({ projectId, onComplete }: CrawlLogStreamProps) {
  const t = useTranslations('projects.overview.log')
  const [snapshot, setSnapshot] = useState<CrawlSnapshot | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const seenStatus = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/crawls/latest`,
          {
            headers: { 'X-Requested-With': 'fetch' },
            cache: 'no-store',
          },
        )
        if (!res.ok) return
        const data = (await res.json()) as CrawlSnapshot
        if (cancelled) return
        setSnapshot(data)

        const status = data.crawl?.status
        if (status && seenStatus.current !== status) {
          seenStatus.current = status
          if (status === 'completed' || status === 'failed') {
            onComplete?.()
          }
        }
      } catch {
        // silencioso
      }
    }

    load()
    const interval = setInterval(load, 2_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [projectId, onComplete])

  // Auto-scroll
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [snapshot?.pages.length, snapshot?.crawl?.status])

  if (!snapshot?.crawl) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const events = buildEvents(snapshot, t)
  const { crawl } = snapshot
  const running = crawl.status === 'running' || crawl.status === 'pending'

  return (
    <div className="surface-card glow-teal-sm overflow-hidden rounded-xl">
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          {running ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : crawl.status === 'completed' ? (
            <CheckCircle2 className="size-4 text-fin-gain" />
          ) : (
            <XCircle className="size-4 text-destructive" />
          )}
          <span className="font-mono text-xs font-medium uppercase tracking-wider">
            {t(`status.${crawl.status}`)}
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
          <span>
            {t('pages_counter', { count: snapshot.pages.length })}
          </span>
        </div>
      </div>

      {/* log */}
      <div
        ref={scrollerRef}
        className="relative h-64 overflow-y-auto bg-background/40 px-4 py-3 font-mono text-xs leading-relaxed scrollbar-none"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
        }}
        aria-live="polite"
        role="log"
      >
        {events.map((ev) => (
          <div
            key={ev.id}
            className={cn(
              'flex items-start gap-2 py-0.5',
              ev.level === 'success' && 'text-fin-gain',
              ev.level === 'error' && 'text-destructive',
              ev.level === 'progress' && 'text-primary',
              ev.level === 'info' && 'text-muted-foreground',
            )}
          >
            <span className="shrink-0 tabular-nums opacity-60">
              {formatTime(ev.timestamp, new Date(crawl.createdAt))}
            </span>
            <span className="shrink-0">
              {ev.level === 'success' ? (
                <CheckCircle2 className="mt-[1px] size-3" />
              ) : ev.level === 'error' ? (
                <XCircle className="mt-[1px] size-3" />
              ) : ev.level === 'progress' ? (
                <Loader2 className="mt-[1px] size-3 animate-spin" />
              ) : (
                <Circle className="mt-[1px] size-3" />
              )}
            </span>
            <span className="break-all">{ev.message}</span>
          </div>
        ))}
        {running ? (
          <div className="flex items-center gap-2 py-0.5 text-primary">
            <span className="shrink-0 tabular-nums opacity-60">
              {formatTime(new Date(), new Date(crawl.createdAt))}
            </span>
            <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
            <span className="text-muted-foreground">{t('cursor')}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

type TFn = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string

function buildEvents(snapshot: CrawlSnapshot, t: TFn): LogEvent[] {
  const events: LogEvent[] = []
  const crawl = snapshot.crawl
  if (!crawl) return events

  events.push({
    id: `created-${crawl.id}`,
    level: 'info',
    message: t('events.queued'),
    timestamp: new Date(crawl.createdAt),
  })

  if (crawl.startedAt) {
    events.push({
      id: `started-${crawl.id}`,
      level: 'info',
      message: t('events.worker_ready'),
      timestamp: new Date(crawl.startedAt),
    })
  }

  for (const p of snapshot.pages) {
    events.push({
      id: `page-${p.id}`,
      level: 'success',
      message: t('events.captured', {
        url: shortUrl(p.url),
        elements: p.elementsCount,
      }),
      timestamp: new Date(p.discoveredAt),
    })
  }

  if (crawl.finishedAt) {
    if (crawl.status === 'completed') {
      events.push({
        id: `done-${crawl.id}`,
        level: 'success',
        message: t('events.completed', { count: crawl.pagesCount }),
        timestamp: new Date(crawl.finishedAt),
      })
    } else if (crawl.status === 'failed') {
      events.push({
        id: `failed-${crawl.id}`,
        level: 'error',
        message: t('events.failed', {
          reason: crawl.error?.slice(0, 200) ?? 'unknown',
        }),
        timestamp: new Date(crawl.finishedAt),
      })
    }
  }

  return events
}

function shortUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return (u.pathname + u.search) || '/'
  } catch {
    return raw
  }
}

function formatTime(d: Date, start: Date): string {
  const diffMs = d.getTime() - start.getTime()
  if (diffMs < 0) return '+00:00'
  const seconds = Math.floor(diffMs / 1000)
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `+${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}
