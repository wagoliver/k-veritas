'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Download,
  FileCode2,
  Image as ImageIcon,
  Loader2,
  Play,
  Settings as SettingsIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DateTime } from '@/components/ui/date-time'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  locateFailedStepIndex,
  parseTestCode,
} from '@/lib/ai/parse-playwright-test'
import { parsePlaywrightError } from '@/lib/ai/parse-playwright-error'
import { ProjectSetupSheet } from './project-setup'
import {
  TestFlowView,
  type StepArtifact,
  type StepStatus,
} from './test-flow-view'

// Tipos locais do modelo novo (feature_ai_scenario_tests). Mapeamos
// aiScenarios[].description → title pra preservar a UX herdada do
// analysis-editor sem acoplar com o tipo antigo.
interface ExecLatestTest {
  code: string
  model: string | null
  createdAt: string
  createdBy: string | null
}

interface ExecScenario {
  id: string
  title: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  latestTest: ExecLatestTest | null
}

interface ExecFeature {
  id: string
  externalId: string
  name: string
  description: string
  paths: string[]
  scenarios: ExecScenario[]
}

interface RunStepEvent {
  stepIndex: number
  title: string
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number | null
  errorMessage: string | null
  lineInSpec: number | null
}

interface RunDetail {
  screenshotUrl: string | null
  traceUrl: string | null
  videoUrl: string | null
  stepEvents: RunStepEvent[]
  errorMessage: string | null
  errorStack: string | null
}

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

interface FeaturesPayload {
  features: Array<{
    id: string
    externalId: string
    name: string
    description: string
    paths: string[]
    approvedAt: string | null
    aiScenarios?: Array<{
      id: string
      description: string
      priority: 'critical' | 'high' | 'normal' | 'low'
      latestTest: ExecLatestTest | null
    }>
  }>
}

export function ProjectExecution({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.execution')
  const [features, setFeatures] = useState<ExecFeature[] | null>(null)
  const [latest, setLatest] = useState<LatestResult[]>([])
  const [running, setRunning] = useState<RunningInfo[]>([])
  const [tick, setTick] = useState(0)
  const [setupOpen, setSetupOpen] = useState(false)
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
      const data = (await fRes.json()) as FeaturesPayload
      // Mapeia aiScenarios (modelo novo) → shape usada pela UI de execução.
      // description vira title; só entra feature que está aprovada.
      const mapped: ExecFeature[] = data.features
        .filter((f) => f.approvedAt !== null)
        .map((f) => ({
          id: f.id,
          externalId: f.externalId,
          name: f.name,
          description: f.description,
          paths: f.paths,
          scenarios: (f.aiScenarios ?? []).map((s) => ({
            id: s.id,
            title: s.description,
            priority: s.priority,
            latestTest: s.latestTest,
          })),
        }))
      setFeatures(mapped)
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
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSetupOpen(true)}
          >
            <SettingsIcon className="size-3.5" />
            {t('open_setup')}
          </Button>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <Play className="size-8 text-muted-foreground" />
          <p className="max-w-md text-sm text-muted-foreground">
            {t('empty')}
          </p>
        </div>
        <ProjectSetupSheet
          projectId={projectId}
          open={setupOpen}
          onOpenChange={setSetupOpen}
        />
      </section>
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSetupOpen(true)}
        >
          <SettingsIcon className="size-3.5" />
          {t('open_setup')}
        </Button>
      </div>

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

      <ProjectSetupSheet
        projectId={projectId}
        open={setupOpen}
        onOpenChange={setSetupOpen}
      />
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
  feature: ExecFeature
  projectId: string
  latestByScenario: Map<string, LatestResult>
  runningByScenario: Map<string, RunningInfo>
  onChanged: () => Promise<void> | void
}) {
  const t = useTranslations('projects.overview.execution')
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  // Cenários que já estão rodando não podem ser selecionados — filtra da
  // seleção sempre que a lista muda.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        const isRunning = runningByScenario.has(id)
        const exists = feature.scenarios.some((s) => s.id === id)
        if (exists && !isRunning) next.add(id)
      }
      return next
    })
  }, [feature.scenarios, runningByScenario])

  const selectableIds = feature.scenarios
    .filter((s) => !runningByScenario.has(s.id))
    .map((s) => s.id)
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selected.has(id))
  const selectedCount = selected.size

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev)
        for (const id of selectableIds) next.delete(id)
        return next
      }
      const next = new Set(prev)
      for (const id of selectableIds) next.add(id)
      return next
    })
  }

  const runOne = async (
    scenarioId: string,
  ): Promise<{ ok: boolean; status?: number }> => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/ai-scenarios/${scenarioId}/run`,
        {
          method: 'POST',
          headers: { 'X-Requested-With': 'fetch' },
        },
      )
      return { ok: res.ok, status: res.status }
    } catch {
      return { ok: false }
    }
  }

  const runSelected = async () => {
    const ids = Array.from(selected).filter(
      (id) =>
        !runningByScenario.has(id) &&
        feature.scenarios.some((s) => s.id === id),
    )
    if (ids.length === 0) return
    setSubmitting(true)
    setSelected(new Set())
    const results = await Promise.all(ids.map((id) => runOne(id)))
    const ok = results.filter((r) => r.ok).length
    const hasRate = results.some((r) => r.status === 429)
    const hasMissing = results.some((r) => r.status === 409)
    if (hasRate) toast.error(t('errors.rate_limited'))
    else if (hasMissing) toast.error(t('errors.no_generated_test'))
    else toast.success(t('enqueued_batch', { count: ok }))
    setSubmitting(false)
    await onChanged()
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          aria-expanded={open}
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
            <p className="text-sm text-muted-foreground">
              {feature.description}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0 text-[10px] font-medium tabular-nums text-muted-foreground">
            {feature.scenarios.length}
          </span>
        </button>
        {open && selectedCount > 0 ? (
          <Button
            type="button"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              void runSelected()
            }}
            disabled={submitting}
            className="shrink-0"
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {t('run_selected', { count: selectedCount })}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-2 border-t border-border/40 bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleSelectAll}
              disabled={submitting || selectableIds.length === 0}
              aria-label={t('select_all')}
            />
            <span className="text-[11px] text-muted-foreground">
              {t('select_all')}
            </span>
          </div>
          <ul className="space-y-2">
            {feature.scenarios.map((s) => (
              <ScenarioRunRow
                key={s.id}
                scenario={s}
                projectId={projectId}
                latest={latestByScenario.get(s.id) ?? null}
                running={runningByScenario.get(s.id) ?? null}
                selected={selected.has(s.id)}
                onToggleSelect={() => toggleSelect(s.id)}
                onChanged={onChanged}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ScenarioRunRow({
  scenario,
  projectId,
  latest,
  running,
  selected,
  onToggleSelect,
  onChanged,
}: {
  scenario: ExecScenario
  projectId: string
  latest: LatestResult | null
  running: RunningInfo | null
  selected: boolean
  onToggleSelect: () => void
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
      <Checkbox
        checked={selected}
        onCheckedChange={onToggleSelect}
        disabled={isRunning}
        className="mt-1"
        aria-label={t('select_scenario')}
      />
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
        {scenario.latestTest ? (
          <RunFlow
            code={scenario.latestTest.code}
            errorMessage={latest?.errorMessage ?? null}
            projectId={projectId}
            scenarioId={scenario.id}
            runId={latest?.runId ?? null}
            status={latest?.status ?? null}
            onChanged={onChanged}
          />
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

function RunFlow({
  code,
  errorMessage,
  projectId,
  scenarioId,
  runId,
  status,
  onChanged,
}: {
  code: string
  errorMessage: string | null
  projectId: string
  scenarioId: string
  runId: string | null
  status: 'passed' | 'failed' | 'skipped' | 'timedout' | null
  onChanged: () => Promise<void> | void
}) {
  const t = useTranslations('projects.overview.execution')
  const tEditor = useTranslations('projects.overview.analysis.editor')
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  // `fetched` fecha o loop quando a API responde sem match ou com array
  // vazio: sem esse flag o effect re-roda pra sempre tentando popular
  // `detail` que nunca é setado.
  const [fetched, setFetched] = useState(false)
  const [lightbox, setLightbox] = useState(false)

  const parsed = parseTestCode(code)
  const failedStepIndex =
    errorMessage && status !== null && status !== 'passed'
      ? locateFailedStepIndex(parsed, errorMessage)
      : null

  const saveStepEdit = async (newCode: string) => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/ai-scenarios/${scenarioId}/tests`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({ code: newCode }),
        },
      )
      if (!res.ok) {
        toast.error(tEditor('test.edit_failed'))
        return
      }
      toast.success(tEditor('test.edit_saved'))
      await onChanged()
    } catch {
      toast.error(tEditor('errors.network'))
    }
  }

  // Reset do fetched quando o runId muda (ex.: após um re-run).
  useEffect(() => {
    setFetched(false)
    setDetail(null)
  }, [runId])

  // Carrega os detalhes do run (step events + screenshot + trace) só quando
  // o usuário expande o flow, pra não fazer N+1 requests no listing.
  // Sem runId (cenário nunca foi rodado) não há detail pra buscar.
  useEffect(() => {
    if (!runId) return
    if (!open || fetched || loadingDetail) return
    let cancelled = false
    setLoadingDetail(true)
    fetch(`/api/projects/${projectId}/test-exec/runs/${runId}`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as {
          results: Array<{
            scenarioIdSnapshot: string
            screenshotUrl: string | null
            traceUrl: string | null
            videoUrl: string | null
            errorMessage: string | null
            errorStack: string | null
            stepEvents: RunStepEvent[]
          }>
        }
        if (cancelled) return
        const match =
          data.results.find((r) => r.scenarioIdSnapshot === scenarioId) ??
          data.results[0]
        // Sempre grava algo no detail: se não achou, fica com campos
        // vazios pro EvidenceBlock mostrar "sem evidências" em vez de
        // ficar em loading infinito.
        setDetail(
          match
            ? {
                screenshotUrl: match.screenshotUrl,
                traceUrl: match.traceUrl,
                videoUrl: match.videoUrl,
                stepEvents: match.stepEvents,
                errorMessage: match.errorMessage,
                errorStack: match.errorStack,
              }
            : {
                screenshotUrl: null,
                traceUrl: null,
                videoUrl: null,
                stepEvents: [],
                errorMessage: null,
                errorStack: null,
              },
        )
      })
      .catch(() => {
        if (!cancelled) toast.error(t('errors.network'))
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false)
          setFetched(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, fetched, loadingDetail, projectId, runId, scenarioId, t])

  // Status derivado a partir dos step events reais (preferível) ou da
  // heurística `locateFailedStepIndex` (fallback quando ainda carregando).
  const flatCount = parsed.phases.reduce((n, p) => n + p.steps.length, 0)

  const { stepStatuses, stepArtifacts } = useMemo(() => {
    if (detail && detail.stepEvents.length > 0) {
      const statuses: StepStatus[] = Array.from({ length: flatCount }, () => 'idle')
      const artifacts: (StepArtifact | null)[] = Array.from(
        { length: flatCount },
        () => null,
      )
      const eventsInOrder = [...detail.stepEvents].sort(
        (a, b) => a.stepIndex - b.stepIndex,
      )
      // Map 1:1 pelo índice: o reporter emite steps na mesma ordem em
      // que o parser vê (ambos filtram top-level pw:api).
      for (let i = 0; i < eventsInOrder.length && i < flatCount; i++) {
        const ev = eventsInOrder[i]
        statuses[i] = ev.status === 'skipped' ? 'idle' : ev.status
        artifacts[i] = {
          durationMs: ev.durationMs,
          errorMessage: ev.errorMessage,
        }
      }
      return { stepStatuses: statuses, stepArtifacts: artifacts }
    }

    // Fallback heurístico enquanto detalhe não carregou (ou cenário nunca
    // rodou). Regras:
    //   - passed:             tudo verde
    //   - failed + índice:    verde até, vermelho no step falho, resto idle
    //   - null / ambíguo:     tudo idle (preview só do código)
    const statuses: StepStatus[] =
      status === 'passed'
        ? Array.from({ length: flatCount }, () => 'passed' as const)
        : failedStepIndex !== null
          ? Array.from({ length: flatCount }, (_, i) =>
              i < failedStepIndex
                ? 'passed'
                : i === failedStepIndex
                  ? 'failed'
                  : 'idle',
            )
          : Array.from({ length: flatCount }, () => 'idle' as const)
    return { stepStatuses: statuses, stepArtifacts: null }
  }, [detail, failedStepIndex, flatCount, status])

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
        <>
          {errorMessage && status !== null && status !== 'passed' ? (
            <div className="border-t border-border/40">
              <ErrorSummary message={errorMessage} />
            </div>
          ) : null}
          <TestFlowView
            code={code}
            failedStepIndex={failedStepIndex}
            stepStatuses={stepStatuses}
            stepArtifacts={stepArtifacts}
            editable
            onCodeChange={saveStepEdit}
          />
          <EvidenceBlock
            detail={detail}
            loading={loadingDetail}
            onOpenLightbox={() => setLightbox(true)}
          />
        </>
      ) : null}
      {lightbox && detail?.screenshotUrl ? (
        <ScreenshotLightbox
          url={detail.screenshotUrl}
          onClose={() => setLightbox(false)}
        />
      ) : null}
    </div>
  )
}

function EvidenceBlock({
  detail,
  loading,
  onOpenLightbox,
}: {
  detail: RunDetail | null
  loading: boolean
  onOpenLightbox: () => void
}) {
  const t = useTranslations('projects.overview.execution')

  if (loading) {
    return (
      <div className="flex items-center gap-2 border-t border-border/40 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {t('evidence_loading')}
      </div>
    )
  }

  if (!detail) return null

  const { screenshotUrl, traceUrl, videoUrl } = detail

  if (!screenshotUrl && !traceUrl && !videoUrl) {
    return (
      <div className="border-t border-border/40 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        {t('evidence_empty')}
      </div>
    )
  }

  return (
    <div className="space-y-3 border-t border-border/40 bg-muted/20 p-3">
      {videoUrl ? (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Play className="size-3" />
            {t('evidence_video_label')}
          </div>
          <video
            src={videoUrl}
            controls
            preload="metadata"
            className="w-full max-h-96 rounded border border-border bg-background"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t('evidence_video_hint')}
          </p>
        </div>
      ) : null}
      {screenshotUrl ? (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ImageIcon className="size-3" />
            {t('evidence_screenshot_label')}
          </div>
          <button
            type="button"
            onClick={onOpenLightbox}
            className="block w-full overflow-hidden rounded border border-border bg-background transition-opacity hover:opacity-90"
          >
            <img
              src={screenshotUrl}
              alt={t('evidence_screenshot_alt')}
              loading="lazy"
              className="max-h-80 w-full object-contain"
            />
          </button>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t('evidence_screenshot_hint')}
          </p>
        </div>
      ) : null}
      {traceUrl ? (
        <div>
          <a
            href={traceUrl}
            download
            className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Download className="size-3" />
            {t('evidence_trace_download')}
          </a>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t('evidence_trace_hint')}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function ScreenshotLightbox({
  url,
  onClose,
}: {
  url: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <img
        src={url}
        alt=""
        className="max-h-[90vh] max-w-[90vw] rounded border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

function ErrorSummary({ message }: { message: string }) {
  const t = useTranslations('projects.overview.execution')
  const parsed = parsePlaywrightError(message)

  const categoryLabel: Record<typeof parsed.category, string> = {
    timeout: t('error_category_timeout'),
    assertion: t('error_category_assertion'),
    navigation: t('error_category_navigation'),
    locator: t('error_category_locator'),
    target_closed: t('error_category_target_closed'),
    network: t('error_category_network'),
    unknown: t('error_category_unknown'),
  }

  return (
    <div className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="rounded bg-destructive/20 px-1.5 py-0.5 font-medium uppercase tracking-wider text-destructive">
          {categoryLabel[parsed.category]}
        </span>
        {parsed.timeoutMs !== null ? (
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-mono tabular-nums text-destructive">
            {parsed.timeoutMs}ms
          </span>
        ) : null}
        {parsed.locator ? (
          <span className="truncate rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-destructive">
            {parsed.locator}
          </span>
        ) : null}
      </div>
      {parsed.summary ? (
        <p className="font-mono text-[11px] leading-relaxed text-destructive">
          {parsed.summary}
        </p>
      ) : null}
      <details className="group">
        <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
          {t('error_stack_toggle')}
        </summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-card p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          <code>{message}</code>
        </pre>
      </details>
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
