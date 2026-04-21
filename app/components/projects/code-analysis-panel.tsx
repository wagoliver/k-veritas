'use client'

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Code2,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Link } from '@/lib/i18n/navigation'
import { cn } from '@/lib/utils'
import { CodeAnalysisLogStream } from './code-analysis-log-stream'
import { FeatureContextCards } from './feature-context-cards'

interface CodeJobSnapshot {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  sourceType: 'url' | 'repo'
  repoUrl: string | null
  repoBranch: string | null
  currentStepLabel: string | null
  stepsCompleted: number
  tokensIn: number
  tokensOut: number
  turnsUsed: number
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

interface LatestResponse {
  job: CodeJobSnapshot | null
  project: {
    sourceType: 'url' | 'repo'
    repoUrl: string | null
    repoBranch: string | null
    hasBusinessContext: boolean
  }
}

export function CodeAnalysisPanel({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.map.code')
  const [data, setData] = useState<LatestResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  // Guarda o último status que vimos pra tocar o toast "concluído"
  // exatamente uma vez na transição de running→completed.
  const lastStatusRef = useRef<string | null>(null)
  const cancelledRef = useRef(false)

  const loadLatest = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/code-analyses/latest`,
        {
          headers: { 'X-Requested-With': 'fetch' },
          cache: 'no-store',
        },
      )
      if (!res.ok) return
      const body = (await res.json()) as LatestResponse
      if (cancelledRef.current) return
      setData(body)

      // Detecta transição pra estado final e toca toast.
      const status = body.job?.status ?? null
      if (status && status !== lastStatusRef.current) {
        const prev = lastStatusRef.current
        lastStatusRef.current = status
        if (prev && (status === 'completed' || status === 'failed')) {
          if (status === 'completed') {
            toast.success(t('toast_completed'))
          } else {
            toast.error(t('toast_failed'))
          }
        }
      }
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    cancelledRef.current = false
    loadLatest()
    const interval = setInterval(loadLatest, 2_500)
    return () => {
      cancelledRef.current = true
      clearInterval(interval)
    }
  }, [loadLatest])

  const trigger = async () => {
    setStarting(true)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/code-analyses`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({}),
        },
      )
      if (res.status === 429) {
        toast.error(t('errors.rate_limited'))
        return
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        const reason =
          payload?.fields?.anthropicKey ??
          payload?.fields?.source ??
          payload?.title
        if (reason === 'anthropic_key_missing') {
          toast.error(t('errors.anthropic_key_missing'))
          return
        }
        if (reason === 'source_not_configured') {
          toast.error(t('errors.source_not_configured'))
          return
        }
        toast.error(t('errors.generic'))
        return
      }
      toast.success(t('triggered'))
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setStarting(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) return null

  const job = data.job
  const project = data.project
  const sourceConfigured =
    project.sourceType === 'repo' &&
    (project.repoUrl !== null || /* ZIP fallback futuro */ false)

  // Empty state — nenhum job rodou ainda.
  if (!job) {
    return (
      <EmptyState
        onAnalyze={trigger}
        starting={starting}
        sourceConfigured={sourceConfigured}
        project={project}
        t={t}
      />
    )
  }

  const running = job.status === 'pending' || job.status === 'running'

  return (
    <div className="surface-card overflow-hidden rounded-xl">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusIcon status={job.status} />
          <span className="font-mono text-xs font-medium uppercase tracking-wider">
            {t(`status.${job.status}`)}
          </span>
          {running && job.currentStepLabel ? (
            <span className="text-xs text-muted-foreground">
              · {job.currentStepLabel}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {!running ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={trigger}
              disabled={starting || !sourceConfigured}
            >
              {starting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {t('reanalyze_button')}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 p-4 sm:grid-cols-3">
        <Metric
          label={t('metrics.steps')}
          value={String(job.stepsCompleted)}
        />
        <Metric
          label={t('metrics.tokens')}
          value={`${formatK(job.tokensIn)} / ${formatK(job.tokensOut)}`}
        />
        <Metric
          label={t('metrics.turns')}
          value={String(job.turnsUsed)}
        />
      </div>

      <div className="border-t border-border p-4">
        <CodeAnalysisLogStream
          projectId={projectId}
          jobId={job.id}
          // Força reload imediato do /latest quando o stream detecta
          // transição pra completed/failed — não espera o tick de 2.5s.
          onComplete={loadLatest}
        />
      </div>

      {job.status === 'failed' && job.error ? (
        <div className="border-t border-border bg-destructive/5 px-4 py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-5 shrink-0 translate-y-0.5 text-destructive" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold text-destructive">
                {t('completed_failed_title')}
              </p>
              <p className="text-xs text-destructive/90">
                {job.error.slice(0, 400)}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={trigger}
              disabled={starting || !sourceConfigured}
            >
              {starting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {t('reanalyze_button')}
            </Button>
          </div>
        </div>
      ) : null}

      {job.status === 'completed' ? (
        <>
          <div className="border-t border-fin-gain/30 bg-fin-gain/5 px-4 py-5">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fin-gain/15 text-fin-gain">
                <CheckCircle2 className="size-5" />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold text-fin-gain">
                  {t('completed_banner_title')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('completed_banner_subtitle', {
                    tokens: formatK(job.tokensIn + job.tokensOut),
                    turns: job.turnsUsed,
                  })}
                </p>
                {job.error ? (
                  <p className="pt-1 text-xs text-amber-600 dark:text-amber-400">
                    {t('completed_with_warning_hint')}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" asChild>
                  <Link href={`/projects/${projectId}/analysis`}>
                    {t('completed_cta_scenarios')}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
          <div className="border-t border-border bg-background p-4">
            <FeatureContextCards projectId={projectId} />
          </div>
        </>
      ) : null}
    </div>
  )
}

function EmptyState({
  onAnalyze,
  starting,
  sourceConfigured,
  project,
  t,
}: {
  onAnalyze: () => void
  starting: boolean
  sourceConfigured: boolean
  project: LatestResponse['project']
  t: (key: string) => string
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border p-10 text-center">
      <Code2 className="size-10 text-muted-foreground" />
      <div className="max-w-lg space-y-1">
        <p className="text-sm font-medium">{t('empty_title')}</p>
        <p className="text-xs text-muted-foreground">{t('empty_description')}</p>
      </div>
      {sourceConfigured && project.repoUrl ? (
        <div className="max-w-lg rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <span className="font-mono">{project.repoUrl}</span>
          {project.repoBranch ? (
            <span className="text-muted-foreground"> · {project.repoBranch}</span>
          ) : null}
        </div>
      ) : (
        <p className="max-w-lg text-xs text-muted-foreground">
          {t('source_not_configured_hint')}
        </p>
      )}
      <Button
        type="button"
        onClick={onAnalyze}
        disabled={starting || !sourceConfigured}
      >
        {starting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        {t('analyze_button')}
      </Button>
    </div>
  )
}

function StatusIcon({
  status,
}: {
  status: CodeJobSnapshot['status']
}) {
  if (status === 'running' || status === 'pending') {
    return <Loader2 className="size-4 animate-spin text-primary" />
  }
  if (status === 'completed') {
    return <CheckCircle2 className="size-4 text-fin-gain" />
  }
  if (status === 'failed') {
    return <AlertCircle className="size-4 text-destructive" />
  }
  return <Code2 className={cn('size-4 text-muted-foreground')} />
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm tabular-nums">{value}</div>
    </div>
  )
}

function formatK(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
