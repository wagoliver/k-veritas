'use client'

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileCode2,
  FileSearch,
  FolderDown,
  FolderOpen,
  Loader2,
  Sparkles,
  Terminal,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

interface JobSnapshot {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  stepsCompleted: number
  tokensIn: number
  tokensOut: number
  turnsUsed: number
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

interface EventRow {
  id: string
  createdAt: string
  kind: 'status' | 'tool' | 'text' | 'error'
  label: string
  detail: string | null
}

interface Snapshot {
  job: JobSnapshot
  events: EventRow[]
}

interface Props {
  projectId: string
  jobId: string
  onComplete?: () => void
}

export function CodeAnalysisLogStream({ projectId, jobId, onComplete }: Props) {
  const t = useTranslations('projects.overview.map.code.log')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const lastStatusRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/code-analyses/${jobId}/events`,
          {
            headers: { 'X-Requested-With': 'fetch' },
            cache: 'no-store',
          },
        )
        if (!res.ok) return
        const data = (await res.json()) as Snapshot
        if (cancelled) return
        setSnapshot(data)

        const status = data.job.status
        if (status !== lastStatusRef.current) {
          lastStatusRef.current = status
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
  }, [projectId, jobId, onComplete])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [snapshot?.events.length, snapshot?.job.status])

  if (!snapshot) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const { job, events } = snapshot
  const running = job.status === 'running' || job.status === 'pending'
  const start = new Date(job.createdAt)
  const toolCount = events.filter((e) => e.kind === 'tool').length

  return (
    <div className="surface-card glow-teal-sm overflow-hidden rounded-xl">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          {running ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : job.status === 'completed' ? (
            <CheckCircle2 className="size-4 text-fin-gain" />
          ) : (
            <XCircle className="size-4 text-destructive" />
          )}
          <span className="font-mono text-xs font-medium uppercase tracking-wider">
            {t(`status.${job.status}`)}
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
          <span>{t('tools_counter', { count: toolCount })}</span>
          <span>
            {t('tokens_counter', {
              inTok: formatK(job.tokensIn),
              outTok: formatK(job.tokensOut),
            })}
          </span>
          <span>{t('turns_counter', { count: job.turnsUsed })}</span>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="relative h-72 overflow-y-auto bg-background/40 px-4 py-3 font-mono text-xs leading-relaxed scrollbar-none"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
        }}
        aria-live="polite"
        role="log"
      >
        {events.length === 0 ? (
          <div className="flex items-center gap-2 py-0.5 text-muted-foreground">
            <Circle className="mt-[1px] size-3" />
            <span>{t('waiting_first_event')}</span>
          </div>
        ) : null}
        {events.map((ev) => {
          const visual = visualFor(ev, t)
          return (
            <div
              key={ev.id}
              className={cn('flex items-start gap-2 py-0.5', visual.className)}
            >
              <span className="shrink-0 tabular-nums opacity-60">
                {formatTime(new Date(ev.createdAt), start)}
              </span>
              <visual.Icon className="mt-[1px] size-3 shrink-0" />
              <span className="min-w-0 flex-1 break-all">
                <span className="font-medium">{visual.title}</span>
                {ev.detail ? (
                  <span className="ml-2 opacity-70">{ev.detail}</span>
                ) : null}
              </span>
            </div>
          )
        })}
        {running ? (
          <div className="flex items-center gap-2 py-0.5 text-primary">
            <span className="shrink-0 tabular-nums opacity-60">
              {formatTime(new Date(), start)}
            </span>
            <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
            <span className="text-muted-foreground">{t('cursor')}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface TFn {
  (key: string, values?: Record<string, string | number | Date>): string
  has?: (key: string) => boolean
}

function safeT(t: TFn, key: string, fallback: string): string {
  if (t.has && !t.has(key)) return fallback
  try {
    return t(key)
  } catch {
    return fallback
  }
}

// Mapeia cada (kind, label) pra um ícone + classe de cor + título
// legível. Fallback: ícone genérico + label cru.
function visualFor(
  ev: EventRow,
  t: TFn,
): { Icon: LucideIcon; title: string; className: string } {
  if (ev.kind === 'error') {
    return {
      Icon: AlertTriangle,
      title: safeT(t, `label.error.${ev.label}`, ev.label),
      className: 'text-destructive',
    }
  }
  if (ev.kind === 'status') {
    const statusIcons: Record<string, LucideIcon> = {
      job_started: Circle,
      clone_start: FolderDown,
      clone_done: FolderOpen,
      claude_started: Sparkles,
      import_done: FileCode2,
      completed: CheckCircle2,
      completed_with_warning: AlertTriangle,
      failed: XCircle,
    }
    const tone: Record<string, string> = {
      completed: 'text-fin-gain',
      completed_with_warning: 'text-amber-500',
      failed: 'text-destructive',
      claude_started: 'text-primary',
    }
    return {
      Icon: statusIcons[ev.label] ?? Circle,
      title: safeT(t, `label.status.${ev.label}`, ev.label),
      className: tone[ev.label] ?? 'text-muted-foreground',
    }
  }
  if (ev.kind === 'tool') {
    const toolIcons: Record<string, LucideIcon> = {
      Read: FileSearch,
      Grep: FileSearch,
      Glob: FileSearch,
      Bash: Terminal,
      Write: FileCode2,
      Edit: FileCode2,
    }
    return {
      Icon: toolIcons[ev.label] ?? Terminal,
      title: ev.label,
      className: 'text-primary/80',
    }
  }
  return {
    Icon: Circle,
    title: ev.label,
    className: 'text-muted-foreground',
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

function formatK(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
