'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Sparkles,
  Zap,
} from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface Scenario {
  title: string
  rationale: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  preconditions?: string[]
  dataNeeded?: string[]
}

interface Feature {
  id: string
  name: string
  description: string
  paths: string[]
  scenarios: Scenario[]
}

interface Analysis {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  model: string
  provider: string
  summary: string | null
  inferredLocale: string | null
  features: Feature[]
  error: string | null
  tokensIn: number | null
  tokensOut: number | null
  durationMs: number | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export function ProjectAnalysis({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.analysis')
  const format = useFormatter()
  const [analysis, setAnalysis] = useState<Analysis | null | undefined>(
    undefined,
  )
  const [running, startRun] = useTransition()
  const [tick, setTick] = useState(0)

  const load = async () => {
    const res = await fetch(`/api/projects/${projectId}/ai/analyze`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
    if (!res.ok) return
    const data = (await res.json()) as { analysis: Analysis | null }
    setAnalysis(data.analysis)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Polling enquanto há análise em andamento — reidrata tokens/duracao.
  useEffect(() => {
    const s = analysis?.status
    if (s !== 'pending' && s !== 'running') return
    const intv = setInterval(() => load(), 2000)
    return () => clearInterval(intv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.status, projectId])

  // Tick de 1s para a UI atualizar o tempo decorrido sem novo fetch.
  useEffect(() => {
    const s = analysis?.status
    if (s !== 'pending' && s !== 'running') return
    const intv = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(intv)
  }, [analysis?.status])

  const trigger = () => {
    startRun(async () => {
      try {
        // Dispara a requisição (bloqueia até terminar), mas em paralelo
        // fazemos um primeiro load rápido para pegar a linha running.
        const postPromise = fetch(`/api/projects/${projectId}/ai/analyze`, {
          method: 'POST',
          headers: { 'X-Requested-With': 'fetch' },
        })
        setTimeout(() => {
          void load()
        }, 400)

        const res = await postPromise

        if (res.status === 429) {
          toast.error(t('errors.rate_limited'))
          await load()
          return
        }
        if (res.status === 409) {
          toast.error(t('errors.conflict'))
          await load()
          return
        }
        const data = (await res.json().catch(() => ({}))) as {
          status?: 'completed' | 'failed'
          error?: string
        }
        if (data.status === 'completed') {
          toast.success(t('success'))
        } else if (data.status === 'failed') {
          toast.error(t('errors.failed', { reason: data.error ?? '—' }))
        }
        await load()
      } catch {
        toast.error(t('errors.network'))
      }
    })
  }

  const isInFlight =
    analysis?.status === 'pending' || analysis?.status === 'running'

  const liveElapsedSeconds = analysis?.startedAt
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(analysis.startedAt).getTime()) / 1000),
      )
    : analysis?.createdAt
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(analysis.createdAt).getTime()) / 1000,
          ),
        )
      : 0

  // referência a `tick` garante re-render a cada segundo durante running
  void tick

  if (analysis === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  }

  if (analysis === null) {
    return (
      <div className="surface-card glow-teal-sm flex flex-col items-center gap-4 rounded-xl px-8 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-6" />
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold">
            {t('empty.title')}
          </h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {t('empty.description')}
          </p>
        </div>
        <Button onClick={trigger} disabled={running} size="lg">
          {running ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {t('empty.cta')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header com metadata do run */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {analysis.status === 'completed' ? (
            <CheckCircle2 className="size-5 text-fin-gain" />
          ) : analysis.status === 'failed' ? (
            <AlertTriangle className="size-5 text-destructive" />
          ) : (
            <Loader2 className="size-5 animate-spin text-primary" />
          )}
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-3">
              <span className="font-mono">
                {analysis.provider}/{analysis.model}
              </span>
              {isInFlight ? null : analysis.durationMs ? (
                <span className="tabular-nums">
                  {(analysis.durationMs / 1000).toFixed(1)}s
                </span>
              ) : null}
              {!isInFlight &&
              (analysis.tokensIn || analysis.tokensOut) ? (
                <span className="tabular-nums">
                  {analysis.tokensIn ?? 0} in · {analysis.tokensOut ?? 0} out
                </span>
              ) : null}
            </div>
            {isInFlight ? (
              <div className="font-medium text-primary tabular-nums">
                {analysis.status === 'pending'
                  ? t('progress.pending')
                  : (analysis.tokensOut ?? 0) === 0
                    ? t('progress.waiting_model')
                    : t('progress.generating', {
                        tokens: analysis.tokensOut ?? 0,
                        seconds: liveElapsedSeconds,
                      })}
              </div>
            ) : (
              <div>
                {format.dateTime(new Date(analysis.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </div>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={trigger}
          disabled={running || isInFlight}
        >
          {running ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Zap className="size-4" />
          )}
          {t('reanalyze')}
        </Button>
      </div>

      {analysis.status === 'failed' ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">
            {t('errors.failed_title')}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {analysis.error ?? '—'}
          </p>
        </div>
      ) : null}

      {analysis.summary ? (
        <section className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" />
            {t('summary')}
          </h3>
          <p className="text-sm leading-relaxed">{analysis.summary}</p>
          {analysis.inferredLocale ? (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              locale: {analysis.inferredLocale}
            </p>
          ) : null}
        </section>
      ) : null}

      {analysis.features.length > 0 ? (
        <section>
          <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t('features_count', { count: analysis.features.length })}
          </h3>
          <div className="space-y-2">
            {analysis.features.map((f) => (
              <FeatureCard key={f.id} feature={f} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function FeatureCard({ feature }: { feature: Feature }) {
  const t = useTranslations('projects.overview.analysis')
  const [open, setOpen] = useState(false)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-accent/30"
      >
        <ChevronRight
          className={cn(
            'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-semibold">
              {feature.name}
            </span>
            <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] font-medium tabular-nums text-muted-foreground">
              {feature.scenarios.length}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{feature.description}</p>
          <div className="flex flex-wrap gap-1 pt-1">
            {feature.paths.map((p) => (
              <code
                key={p}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {p}
              </code>
            ))}
          </div>
        </div>
      </button>

      {open ? (
        <ul className="divide-y divide-border/40 border-t border-border">
          {feature.scenarios.map((s, i) => (
            <ScenarioRow key={i} scenario={s} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function ScenarioRow({ scenario }: { scenario: Scenario }) {
  const t = useTranslations('projects.overview.analysis')
  return (
    <li className="p-4">
      <div className="flex items-start gap-3">
        <PriorityBadge priority={scenario.priority} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium">{scenario.title}</p>
          <p className="text-xs italic text-muted-foreground">
            {scenario.rationale}
          </p>
          {scenario.preconditions && scenario.preconditions.length > 0 ? (
            <div className="rounded border border-border/60 bg-background/40 p-2 text-xs">
              <p className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">
                {t('preconditions')}
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {scenario.preconditions.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {scenario.dataNeeded && scenario.dataNeeded.length > 0 ? (
            <div className="rounded border border-border/60 bg-background/40 p-2 text-xs">
              <p className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">
                {t('data_needed')}
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {scenario.dataNeeded.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function PriorityBadge({ priority }: { priority: Scenario['priority'] }) {
  const colors: Record<Scenario['priority'], string> = {
    critical: 'bg-destructive/15 text-destructive',
    high: 'bg-amber-500/15 text-amber-500',
    normal: 'bg-primary/15 text-primary',
    low: 'bg-muted text-muted-foreground',
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        colors[priority],
      )}
    >
      {priority}
    </span>
  )
}
