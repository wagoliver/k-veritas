'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  Loader2,
  Play,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { DateTime } from '@/components/ui/date-time'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface TestRun {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  provider: string
  model: string
  scenariosIncludedCount: number
  featuresCount: number
  filesCount: number
  tokensIn: number | null
  tokensOut: number | null
  durationMs: number | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

interface GeneratedFile {
  id: string
  featureNameSnapshot: string
  filePath: string
  fileContent: string
  createdAt: string
}

interface Summary {
  totalScenarios: number
  reviewedScenarios: number
}

export function ProjectTests({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.tests')
  const [runs, setRuns] = useState<TestRun[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [generating, startGenerate] = useTransition()
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  // referência a tick força re-render a cada 1s durante running
  void tick

  const loadRuns = async () => {
    const res = await fetch(`/api/projects/${projectId}/test-runs`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
    if (!res.ok) return
    const data = (await res.json()) as { runs: TestRun[] }
    setRuns(data.runs)
  }

  const loadSummary = async () => {
    const res = await fetch(`/api/projects/${projectId}/features`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
    if (!res.ok) return
    const data = (await res.json()) as {
      features: Array<{
        scenarios: Array<{ reviewedAt: string | null }>
      }>
    }
    let total = 0
    let reviewed = 0
    for (const f of data.features) {
      for (const s of f.scenarios) {
        total++
        if (s.reviewedAt) reviewed++
      }
    }
    setSummary({ totalScenarios: total, reviewedScenarios: reviewed })
  }

  useEffect(() => {
    loadRuns()
    loadSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Polling leve enquanto houver run running
  useEffect(() => {
    if (!runs) return
    const running = runs.some(
      (r) => r.status === 'pending' || r.status === 'running',
    )
    if (!running) return
    const i = setInterval(loadRuns, 2000)
    return () => clearInterval(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs])

  // Tick de 1s pra timer subir sem refetch
  useEffect(() => {
    if (!runs) return
    const running = runs.some(
      (r) => r.status === 'pending' || r.status === 'running',
    )
    if (!running) return
    const i = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(i)
  }, [runs])

  const trigger = () => {
    if (!summary || summary.reviewedScenarios === 0) {
      toast.error(t('errors.no_reviewed'))
      return
    }

    // Optimistic: insere um run stub já como 'running' no topo da lista pra
    // a UI reagir imediatamente. O polling substitui pelo registro real
    // assim que o server insere a linha.
    const now = new Date().toISOString()
    setRuns((prev) => [
      {
        id: 'optimistic',
        status: 'running',
        provider: '…',
        model: '…',
        scenariosIncludedCount: summary.reviewedScenarios,
        featuresCount: 0,
        filesCount: 0,
        tokensIn: null,
        tokensOut: 0,
        durationMs: 0,
        error: null,
        startedAt: now,
        finishedAt: null,
        createdAt: now,
      },
      ...(prev ?? []),
    ])

    startGenerate(async () => {
      // 500ms depois puxa o row real do banco (que acabou de ser inserido
      // pelo runTestGeneration). Polling continua normal em seguida.
      setTimeout(() => {
        void loadRuns()
      }, 500)
      try {
        const res = await fetch(
          `/api/projects/${projectId}/ai/generate-tests`,
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
          setRuns((prev) => (prev ?? []).filter((r) => r.id !== 'optimistic'))
          await loadRuns()
          return
        }
        if (res.status === 409) {
          toast.error(t('errors.no_reviewed'))
          setRuns((prev) => (prev ?? []).filter((r) => r.id !== 'optimistic'))
          await loadRuns()
          return
        }
        const data = (await res.json().catch(() => ({}))) as {
          status?: 'completed' | 'failed'
          error?: string
          filesCount?: number
        }
        if (data.status === 'completed') {
          toast.success(
            t('generate_success', { count: data.filesCount ?? 0 }),
          )
        } else if (data.status === 'failed') {
          toast.error(t('errors.failed', { reason: data.error ?? '—' }))
        }
        await loadRuns()
      } catch {
        toast.error(t('errors.network'))
        await loadRuns()
      }
    })
  }

  const handleDelete = async (runId: string) => {
    if (!confirm(t('confirm_delete'))) return
    try {
      const res = await fetch(
        `/api/projects/${projectId}/test-runs/${runId}`,
        {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'fetch' },
        },
      )
      if (!res.ok) {
        toast.error(t('errors.delete'))
        return
      }
      toast.success(t('deleted'))
      if (expandedRunId === runId) setExpandedRunId(null)
      await loadRuns()
    } catch {
      toast.error(t('errors.network'))
    }
  }

  if (runs === null || summary === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    )
  }

  const hasRuns = runs.length > 0

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold">
              <FileCode2 className="size-4 text-primary" />
              {t('heading')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('subheading', {
                reviewed: summary.reviewedScenarios,
                total: summary.totalScenarios,
              })}
            </p>
          </div>
          <Button
            onClick={trigger}
            disabled={generating || summary.reviewedScenarios === 0}
            size="default"
          >
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {t('generate_cta')}
          </Button>
        </div>
        {summary.reviewedScenarios === 0 ? (
          <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
            {t('empty_hint')}
          </p>
        ) : null}
      </div>

      {!hasRuns ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <Play className="size-8 text-muted-foreground/60" />
          <p className="max-w-md text-sm text-muted-foreground">
            {t('empty.description')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('history')}
          </h4>
          <div className="space-y-2">
            {runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                projectId={projectId}
                expanded={expandedRunId === run.id}
                onToggle={() =>
                  setExpandedRunId((prev) => (prev === run.id ? null : run.id))
                }
                onDelete={() => handleDelete(run.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface RunCardProps {
  run: TestRun
  projectId: string
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
}

function RunCard({
  run,
  projectId,
  expanded,
  onToggle,
  onDelete,
}: RunCardProps) {
  const t = useTranslations('projects.overview.tests')
  const [files, setFiles] = useState<GeneratedFile[] | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)

  useEffect(() => {
    if (!expanded || files !== null || run.status !== 'completed') return
    setLoadingFiles(true)
    fetch(`/api/projects/${projectId}/test-runs/${run.id}`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { files?: GeneratedFile[] } | null) => {
        setFiles(data?.files ?? [])
      })
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  const download = () => {
    window.location.href = `/api/projects/${projectId}/test-runs/${run.id}/download`
  }

  const isInFlight = run.status === 'pending' || run.status === 'running'

  const liveElapsedSeconds = run.startedAt
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000),
      )
    : Math.max(
        0,
        Math.floor((Date.now() - new Date(run.createdAt).getTime()) / 1000),
      )

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card',
        run.status === 'failed' && 'border-destructive/30',
        run.status === 'completed' && 'border-border',
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? 'collapse' : 'expand'}
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              'size-4 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        </button>
        <div className="mt-0.5 shrink-0">
          {run.status === 'completed' ? (
            <CheckCircle2 className="size-5 text-fin-gain" />
          ) : run.status === 'failed' ? (
            <AlertTriangle className="size-5 text-destructive" />
          ) : (
            <Loader2 className="size-5 animate-spin text-primary" />
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 space-y-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {run.status === 'completed'
                ? t('run_summary', {
                    files: run.filesCount,
                    features: run.featuresCount,
                    scenarios: run.scenariosIncludedCount,
                  })
                : isInFlight
                  ? t('run_running')
                  : t('run_failed')}
            </span>
            {!isInFlight && run.durationMs ? (
              <span className="font-mono text-xs text-muted-foreground">
                {(run.durationMs / 1000).toFixed(1)}s
              </span>
            ) : null}
          </div>

          {isInFlight ? (
            <div className="space-y-0.5">
              <div className="font-medium text-primary tabular-nums">
                {(run.tokensOut ?? 0) === 0
                  ? t('progress.waiting', { seconds: liveElapsedSeconds })
                  : t('progress.generating', {
                      tokens: run.tokensOut ?? 0,
                      seconds: liveElapsedSeconds,
                    })}
              </div>
              {(run.tokensOut ?? 0) === 0 && liveElapsedSeconds > 20 ? (
                <div className="text-[11px] text-muted-foreground">
                  {t('progress.waiting_hint')}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span className="font-mono">
                {run.provider}/{run.model}
              </span>
              <DateTime value={run.createdAt} />
              {run.tokensIn || run.tokensOut ? (
                <span className="tabular-nums">
                  {run.tokensIn ?? 0} in · {run.tokensOut ?? 0} out
                </span>
              ) : null}
            </div>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {run.status === 'completed' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                download()
              }}
            >
              <Download className="size-4" />
              {t('download_zip')}
            </Button>
          ) : null}
          {run.id !== 'optimistic' ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              title={t('delete')}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      {expanded && run.status === 'failed' && run.error ? (
        <div className="border-t border-destructive/20 bg-destructive/5 p-4">
          <p className="font-mono text-xs text-muted-foreground">
            {run.error}
          </p>
        </div>
      ) : null}

      {expanded && run.status === 'completed' ? (
        <div className="border-t border-border/40">
          {loadingFiles ? (
            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('loading_files')}
            </div>
          ) : files && files.length > 0 ? (
            <ul className="divide-y divide-border/40">
              {files.map((f) => (
                <FileRow key={f.id} file={f} />
              ))}
            </ul>
          ) : (
            <p className="p-4 text-xs text-muted-foreground">
              {t('no_files')}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function FileRow({ file }: { file: GeneratedFile }) {
  const t = useTranslations('projects.overview.tests')
  const [open, setOpen] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.fileContent)
      toast.success(t('copied'))
    } catch {
      toast.error(t('copy_failed'))
    }
  }

  return (
    <li>
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-sm">{file.filePath}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            · {file.featureNameSnapshot}
          </span>
        </button>
        <button
          type="button"
          onClick={copy}
          title={t('copy')}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Copy className="size-4" />
        </button>
      </div>
      {open ? (
        <pre className="max-h-[28rem] overflow-auto border-t border-border/40 bg-muted/30 p-4 font-mono text-[11px] leading-relaxed">
          <code>{file.fileContent}</code>
        </pre>
      ) : null}
    </li>
  )
}
