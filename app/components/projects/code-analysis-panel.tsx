'use client'

import {
  AlertCircle,
  CheckCircle2,
  Code2,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CodeAnalysisLogStream } from './code-analysis-log-stream'

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

  useEffect(() => {
    let cancelled = false
    const load = async () => {
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
        if (!cancelled) setData(body)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, 2_500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [projectId])

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
        <CodeAnalysisLogStream projectId={projectId} jobId={job.id} />
      </div>

      {job.status === 'failed' && job.error ? (
        <div className="border-t border-border bg-destructive/5 px-4 py-3 text-xs text-destructive">
          {job.error.slice(0, 400)}
        </div>
      ) : null}

      {job.status === 'completed' ? (
        <div className="border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          {t('completed_hint')}
        </div>
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
