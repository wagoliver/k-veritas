'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileCode2,
  Loader2,
  Play,
} from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { DateTime } from '@/components/ui/date-time'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  locateFailedStepIndex,
  parseTestCode,
} from '@/lib/ai/parse-playwright-test'
import type { EditableFeature, EditableScenario } from './analysis-editor'
import { TestFlowView, type StepStatus } from './test-flow-view'

interface LatestResult {
  scenarioId: string
  runId: string
  status: 'passed' | 'failed' | 'skipped' | 'timedout'
  durationMs: number | null
  errorMessage: string | null
  createdAt: string
}

interface RunningInfo {
  scenarioId: string
  runId: string
  status: 'pending' | 'running'
  createdAt: string
  stepsCompleted: number
  stepsTotal: number
  currentStepLabel: string | null
  currentStepLine: number | null
}

export function ProjectExecution({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.execution')
  const [features, setFeatures] = useState<EditableFeature[] | null>(null)
  const [latest, setLatest] = useState<LatestResult[]>([])
  const [running, setRunning] = useState<RunningInfo[]>([])
  const [tick, setTick] = useState(0)
  void tick

  const load = async () => {
    const [fRes, rRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/features`, {
        headers: { 'X-Requested-With': 'fetch' },
        cache: 'no-store',
      }),
      fetch(`/api/projects/${projectId}/test-exec/latest-results`, {
        headers: { 'X-Requested-With': 'fetch' },
        cache: 'no-store',
      }),
    ])
    if (fRes.ok) {
      const data = (await fRes.json()) as { features: EditableFeature[] }
      setFeatures(data.features)
    }
    if (rRes.ok) {
      const data = (await rRes.json()) as {
        latestByScenario: LatestResult[]
        runningByScenario: RunningInfo[]
      }
      setLatest(data.latestByScenario ?? [])
      setRunning(data.runningByScenario ?? [])
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Polling enquanto houver run em andamento + tick de 1s pro timer
  useEffect(() => {
    if (running.length === 0) return
    const poll = setInterval(load, 2000)
    const ticker = setInterval(() => setTick((x) => x + 1), 1000)
    return () => {
      clearInterval(poll)
      clearInterval(ticker)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running.length])

  const latestByScenario = useMemo(() => {
    const map = new Map<string, LatestResult>()
    for (const r of latest) map.set(r.scenarioId, r)
    return map
  }, [latest])

  const runningByScenario = useMemo(() => {
    const map = new Map<string, RunningInfo>()
    for (const r of running) {
      if (r.scenarioId) map.set(r.scenarioId, r)
    }
    return map
  }, [running])

  if (features === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    )
  }

  // Mostra só features com cenários que têm teste gerado
  const featuresWithTests = features
    .map((f) => ({
      ...f,
      scenarios: f.scenarios.filter((s) => s.latestTest !== null),
    }))
    .filter((f) => f.scenarios.length > 0)

  if (featuresWithTests.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
        <Play className="size-8 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">
          {t('empty')}
        </p>
      </div>
    )
  }

  const totalTests = featuresWithTests.reduce(
    (n, f) => n + f.scenarios.length,
    0,
  )
  const passedCount = [...latestByScenario.values()].filter(
    (r) => r.status === 'passed',
  ).length
  const failedCount = [...latestByScenario.values()].filter(
    (r) => r.status !== 'passed',
  ).length
  const neverRunCount = totalTests - latestByScenario.size

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-3 text-xs">
        <div className="font-medium">
          {t('summary', { total: totalTests })}
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="bg-fin-gain transition-[width]"
            style={{ width: `${(passedCount / totalTests) * 100}%` }}
            title={t('passed_count', { count: passedCount })}
          />
          <div
            className="bg-destructive transition-[width]"
            style={{ width: `${(failedCount / totalTests) * 100}%` }}
            title={t('failed_count', { count: failedCount })}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <Legend color="bg-fin-gain" label={t('legend_passed')} count={passedCount} />
          <Legend
            color="bg-destructive"
            label={t('legend_failed')}
            count={failedCount}
          />
          <Legend
            color="bg-muted-foreground/30"
            label={t('legend_never_run')}
            count={neverRunCount}
          />
        </div>
      </div>

      <div className="space-y-3">
        {featuresWithTests.map((f) => (
          <FeatureRunBlock
            key={f.id}
            feature={f}
            projectId={projectId}
            latestByScenario={latestByScenario}
            runningByScenario={runningByScenario}
            onChanged={load}
          />
        ))}
      </div>
    </section>
  )
}

function Legend({
  color,
  label,
  count,
}: {
  color: string
  label: string
  count: number
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2 rounded-full', color)} />
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{count}</span>
    </span>
  )
}

function FeatureRunBlock({
  feature,
  projectId,
  latestByScenario,
  runningByScenario,
  onChanged,
}: {
  feature: EditableFeature
  projectId: string
  latestByScenario: Map<string, LatestResult>
  runningByScenario: Map<string, RunningInfo>
  onChanged: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-accent/20"
      >
        <ChevronRight
          className={cn(
            'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-semibold">
            {feature.name}
          </div>
          <p className="text-sm text-muted-foreground">{feature.description}</p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0 text-[10px] font-medium tabular-nums text-muted-foreground">
          {feature.scenarios.length}
        </span>
      </button>

      {open ? (
        <ul className="space-y-2 border-t border-border/40 bg-muted/20 p-3">
          {feature.scenarios.map((s) => (
            <ScenarioRunRow
              key={s.id}
              scenario={s}
              projectId={projectId}
              latest={latestByScenario.get(s.id) ?? null}
              running={runningByScenario.get(s.id) ?? null}
              onChanged={onChanged}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function ScenarioRunRow({
  scenario,
  projectId,
  latest,
  running,
  onChanged,
}: {
  scenario: EditableScenario
  projectId: string
  latest: LatestResult | null
  running: RunningInfo | null
  onChanged: () => Promise<void> | void
}) {
  const t = useTranslations('projects.overview.execution')
  const [triggering, startTrigger] = useTransition()

  const isRunning = running !== null
  const isDone = latest !== null && !isRunning

  const run = () => {
    startTrigger(async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/ai-scenarios/${scenario.id}/run`,
          {
            method: 'POST',
            headers: { 'X-Requested-With': 'fetch' },
          },
        )
        if (res.status === 429) {
          toast.error(t('errors.rate_limited'))
          return
        }
        if (res.status === 409) {
          toast.error(t('errors.no_generated_test'))
          return
        }
        if (!res.ok) {
          toast.error(t('errors.generic'))
          return
        }
        toast.success(t('enqueued'))
        await onChanged()
      } catch {
        toast.error(t('errors.network'))
      }
    })
  }

  const elapsedSeconds =
    running && running.createdAt
      ? Math.max(
          0,
          Math.floor((Date.now() - new Date(running.createdAt).getTime()) / 1000),
        )
      : 0

  return (
    <li className="flex items-start gap-3 rounded-md border border-border/60 bg-card p-3 shadow-sm">
      <StatusBadge latest={latest} running={running} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{scenario.title}</p>
        </div>
        {isRunning ? (
          <>
            <p className="text-xs text-primary">
              {running.currentStepLabel
                ? t('running_step', {
                    seconds: elapsedSeconds,
                    step: running.currentStepLabel,
                  })
                : t('running', { seconds: elapsedSeconds })}
            </p>
            {scenario.latestTest ? (
              <LiveFlow
                code={scenario.latestTest.code}
                stepsCompleted={running.stepsCompleted}
                currentStepLine={running.currentStepLine}
              />
            ) : null}
          </>
        ) : isDone && latest ? (
          <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileCode2 className="size-3" />
              <DateTime value={latest.createdAt} />
            </span>
            {latest.durationMs !== null ? (
              <span className="tabular-nums">
                {(latest.durationMs / 1000).toFixed(1)}s
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('never_run')}</p>
        )}
        {isDone && latest && latest.status !== 'passed' && latest.errorMessage ? (
          <>
            <p className="rounded border border-destructive/30 bg-destructive/5 p-2 font-mono text-[11px] text-destructive">
              {latest.errorMessage.length > 400
                ? `${latest.errorMessage.slice(0, 400)}…`
                : latest.errorMessage}
            </p>
            {scenario.latestTest ? (
              <FailedFlow
                code={scenario.latestTest.code}
                errorMessage={latest.errorMessage}
              />
            ) : null}
          </>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={run}
        disabled={triggering || isRunning}
      >
        {triggering || isRunning ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
        {t('run')}
      </Button>
    </li>
  )
}

function LiveFlow({
  code,
  stepsCompleted,
  currentStepLine,
}: {
  code: string
  stepsCompleted: number
  currentStepLine: number | null
}) {
  const parsed = parseTestCode(code)
  const flatCount = parsed.phases.reduce((n, p) => n + p.steps.length, 0)

  // Heurística conservadora: o Nth step concluído corresponde ao Nth step
  // do ParsedTest (o reporter filtra só top-level pw:api, em ordem). Pode
  // haver drift se o mapping do parser não bater 1:1 (asserções extras
  // dentro de um expect.soft, por exemplo), mas pra a maioria dos testes
  // lineares Given/When/Then isso funciona.
  const completed = Math.min(stepsCompleted, flatCount)
  const stepStatuses: StepStatus[] = Array.from({ length: flatCount }, (_, i) =>
    i < completed ? 'passed' : i === completed ? 'running' : 'idle',
  )

  return (
    <TestFlowView
      code={code}
      failedStepIndex={null}
      stepStatuses={stepStatuses}
    />
  )
}

function FailedFlow({
  code,
  errorMessage,
}: {
  code: string
  errorMessage: string
}) {
  const t = useTranslations('projects.overview.execution')
  const [open, setOpen] = useState(false)
  const parsed = parseTestCode(code)
  const failedStepIndex = locateFailedStepIndex(parsed, errorMessage)

  // Status derivado: antes do falho → passed (já executou), o falho →
  // failed, depois → idle (nunca chegou). Sem detecção → todos idle
  // (mostra bolinhas cinzas + o banner fica sem "etapa identificada").
  const flatCount = parsed.phases.reduce((n, p) => n + p.steps.length, 0)
  const stepStatuses: StepStatus[] =
    failedStepIndex !== null
      ? Array.from({ length: flatCount }, (_, i) =>
          i < failedStepIndex
            ? 'passed'
            : i === failedStepIndex
              ? 'failed'
              : 'idle',
        )
      : Array.from({ length: flatCount }, () => 'idle' as const)

  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40"
      >
        <ChevronRight
          className={cn(
            'size-3.5 transition-transform',
            open && 'rotate-90',
          )}
        />
        <FileCode2 className="size-3.5" />
        <span className="flex-1">{t('flow_toggle')}</span>
        {failedStepIndex !== null ? (
          <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
            {t('flow_failed_at')}
          </span>
        ) : null}
      </button>
      {open ? (
        <TestFlowView
          code={code}
          failedStepIndex={failedStepIndex}
          stepStatuses={stepStatuses}
        />
      ) : null}
    </div>
  )
}

function StatusBadge({
  latest,
  running,
}: {
  latest: LatestResult | null
  running: RunningInfo | null
}) {
  if (running) {
    return (
      <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-primary" />
    )
  }
  if (!latest) {
    return <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
  }
  if (latest.status === 'passed') {
    return <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-fin-gain" />
  }
  return (
    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
  )
}
