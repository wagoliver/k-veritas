'use client'

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CodeAnalysisLogStream } from './code-analysis-log-stream'
import { FeatureContextCards } from './feature-context-cards'
import {
  ModelPicker,
  useAnthropicConfig,
  usePersistedModel,
} from './model-picker'

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
  const tDisc = useTranslations('projects.overview.discovery')
  const [data, setData] = useState<LatestResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [modelOverride, setModelOverride] = usePersistedModel(
    `model:${projectId}:code-analysis`,
  )
  const anthropicCfg = useAnthropicConfig()
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
          body: JSON.stringify(
            modelOverride ? { model: modelOverride } : {},
          ),
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
        modelOverride={modelOverride}
        setModelOverride={setModelOverride}
        anthropicCfg={anthropicCfg}
      />
    )
  }

  const running = job.status === 'pending' || job.status === 'running'

  // Estado RUNNING/PENDING ou FAILED: painel completo (como antes)
  if (running || job.status === 'failed') {
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

        <div className="border-t border-border p-4">
          <CodeAnalysisLogStream
            projectId={projectId}
            jobId={job.id}
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
      </div>
    )
  }

  // Estado COMPLETED: header colapsado + cards de feature em foco
  const ago = formatRelativeAgo(
    job.finishedAt ? new Date(job.finishedAt) : new Date(job.createdAt),
  )
  const agoLabel = ago
    ? tDisc('last_analysis', { ago })
    : tDisc('last_analysis_just_now')

  return (
    <div className="space-y-4">
      <div className="surface-card overflow-hidden rounded-xl">
        <header className="flex flex-wrap items-center gap-3 px-4 py-3">
          <CheckCircle2 className="size-4 shrink-0 text-fin-gain" />
          <span className="text-sm text-muted-foreground">{agoLabel}</span>
          {job.error ? (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              · {t('completed_with_warning_hint')}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
              {detailsOpen ? tDisc('hide_details') : tDisc('show_details')}
            </Button>
            {anthropicCfg ? (
              <ModelPicker
                value={modelOverride}
                onChange={setModelOverride}
                provider={anthropicCfg.provider}
                baseUrl={anthropicCfg.baseUrl}
                defaultModel={anthropicCfg.defaultModel}
                compact
              />
            ) : null}
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
        </header>

        {detailsOpen ? (
          <div className="border-t border-border bg-muted/20 p-4">
            <CodeAnalysisLogStream
              projectId={projectId}
              jobId={job.id}
              onComplete={loadLatest}
            />
          </div>
        ) : null}
      </div>

      <FeatureContextCards projectId={projectId} />
    </div>
  )
}

function formatRelativeAgo(date: Date): string | null {
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 60_000) return null
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function EmptyState({
  onAnalyze,
  starting,
  sourceConfigured,
  project,
  t,
  modelOverride,
  setModelOverride,
  anthropicCfg,
}: {
  onAnalyze: () => void
  starting: boolean
  sourceConfigured: boolean
  project: LatestResponse['project']
  t: (key: string) => string
  modelOverride: string | null
  setModelOverride: (v: string | null) => void
  anthropicCfg: ReturnType<typeof useAnthropicConfig>
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
      <div className="flex flex-wrap items-center justify-center gap-2">
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
        {anthropicCfg ? (
          <ModelPicker
            value={modelOverride}
            onChange={setModelOverride}
            provider={anthropicCfg.provider}
            baseUrl={anthropicCfg.baseUrl}
            defaultModel={anthropicCfg.defaultModel}
            compact
          />
        ) : null}
      </div>
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

