'use client'

import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  Download,
  FileCode2,
  History,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { DateTime } from '@/components/ui/date-time'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  ScenarioEditorSheet,
  type ScenarioDraft,
} from './scenario-editor-sheet'
import {
  FeatureEditorSheet,
  type FeatureDraft,
} from './feature-editor-sheet'

export interface Reviewer {
  id: string
  displayName: string
}

export interface LatestTest {
  id: string
  code: string
  testRunId: string
  createdAt: string
}

export interface EditableScenario {
  id: string
  title: string
  rationale: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  preconditions: string[]
  dataNeeded: string[]
  reviewedAt: string | null
  reviewedBy: Reviewer | null
  source: 'ai' | 'manual'
  latestTest: LatestTest | null
}

export interface EditableFeature {
  id: string
  externalId: string
  name: string
  description: string
  paths: string[]
  reviewedAt: string | null
  reviewedBy: Reviewer | null
  source: 'ai' | 'manual'
  scenarios: EditableScenario[]
}

export function AnalysisEditor({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.analysis.editor')
  const [features, setFeatures] = useState<EditableFeature[] | null>(null)
  const [scenarioEdit, setScenarioEdit] = useState<{
    featureId: string
    scenario: EditableScenario | null
  } | null>(null)
  const [featureEdit, setFeatureEdit] = useState<EditableFeature | null | 'new'>(
    null,
  )
  const [generating, startGenerate] = useTransition()
  const [latestRun, setLatestRun] = useState<{
    id: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    provider: string
    model: string
    filesCount: number
    tokensOut: number | null
    durationMs: number | null
    error: string | null
    createdAt: string
  } | null>(null)
  const [tick, setTick] = useState(0)
  void tick

  const load = async () => {
    const res = await fetch(`/api/projects/${projectId}/features`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
    if (!res.ok) return
    const data = (await res.json()) as { features: EditableFeature[] }
    setFeatures(data.features)
  }

  const loadLatestRun = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/test-runs`, {
        headers: { 'X-Requested-With': 'fetch' },
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = (await res.json()) as { runs: Array<typeof latestRun> }
      setLatestRun(data.runs?.[0] ?? null)
    } catch {
      // silencioso
    }
  }

  useEffect(() => {
    load()
    loadLatestRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Polling + tick enquanto houver run em andamento
  useEffect(() => {
    if (!latestRun) return
    if (latestRun.status !== 'pending' && latestRun.status !== 'running')
      return
    const poll = setInterval(() => {
      loadLatestRun()
      load()
    }, 2000)
    const ticker = setInterval(() => setTick((x) => x + 1), 1000)
    return () => {
      clearInterval(poll)
      clearInterval(ticker)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRun?.status])

  const generateTests = () => {
    startGenerate(async () => {
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
          toast.error(t('generate.rate_limited'))
          return
        }
        if (res.status === 409) {
          toast.error(t('generate.no_reviewed'))
          return
        }
        const data = (await res.json().catch(() => ({}))) as {
          status?: 'completed' | 'failed'
          error?: string
          filesCount?: number
        }
        if (data.status === 'completed') {
          toast.success(t('generate.success', { count: data.filesCount ?? 0 }))
        } else if (data.status === 'failed') {
          toast.error(t('generate.failed', { reason: data.error ?? '—' }))
        }
        await Promise.all([load(), loadLatestRun()])
      } catch {
        toast.error(t('generate.network'))
      }
    })
  }

  if (features === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  }

  if (features.length === 0) {
    return null
  }

  const totalScenarios = features.reduce((n, f) => n + f.scenarios.length, 0)
  const reviewedScenarios = features.reduce(
    (n, f) => n + f.scenarios.filter((s) => s.reviewedAt).length,
    0,
  )
  const scenariosWithTest = features.reduce(
    (n, f) => n + f.scenarios.filter((s) => s.latestTest).length,
    0,
  )
  const isGeneratingRun =
    latestRun?.status === 'pending' || latestRun?.status === 'running'
  const liveElapsedSeconds =
    latestRun && isGeneratingRun
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(latestRun.createdAt).getTime()) / 1000,
          ),
        )
      : 0

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('features_count', { count: features.length })}
          <span className="ml-2 font-mono text-[11px] normal-case tracking-normal text-muted-foreground/70">
            {t('reviewed_ratio', {
              reviewed: reviewedScenarios,
              total: totalScenarios,
            })}
            {scenariosWithTest > 0 ? (
              <> · {t('with_test', { count: scenariosWithTest })}</>
            ) : null}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={generateTests}
            disabled={
              generating || isGeneratingRun || reviewedScenarios === 0
            }
            title={
              reviewedScenarios === 0 ? t('generate.hint_no_reviewed') : undefined
            }
          >
            {generating || isGeneratingRun ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Zap className="size-4" />
            )}
            {t('generate.button')}
          </Button>
          {latestRun && latestRun.status === 'completed' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = `/api/projects/${projectId}/test-runs/${latestRun.id}/download`
              }}
            >
              <Download className="size-4" />
              {t('generate.download')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFeatureEdit('new')}
          >
            <Plus className="size-4" />
            {t('add_feature')}
          </Button>
        </div>
      </div>

      {isGeneratingRun ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
          <div className="flex items-center gap-2 font-medium text-primary">
            <Loader2 className="size-3.5 animate-spin" />
            {(latestRun?.tokensOut ?? 0) === 0
              ? t('generate.waiting', { seconds: liveElapsedSeconds })
              : t('generate.generating', {
                  tokens: latestRun?.tokensOut ?? 0,
                  seconds: liveElapsedSeconds,
                })}
          </div>
        </div>
      ) : latestRun && latestRun.status === 'failed' ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <p className="font-medium text-destructive">
            {t('generate.failed_title')}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {latestRun.error ?? '—'}
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        {features.map((f) => (
          <FeatureCard
            key={f.id}
            feature={f}
            projectId={projectId}
            onChanged={load}
            onEditScenario={(s) =>
              setScenarioEdit({ featureId: f.id, scenario: s })
            }
            onAddScenario={() =>
              setScenarioEdit({ featureId: f.id, scenario: null })
            }
            onEditFeature={() => setFeatureEdit(f)}
          />
        ))}
      </div>

      {scenarioEdit ? (
        <ScenarioEditorSheet
          projectId={projectId}
          featureId={scenarioEdit.featureId}
          scenario={scenarioEdit.scenario}
          open
          onClose={() => setScenarioEdit(null)}
          onSaved={async () => {
            setScenarioEdit(null)
            await load()
          }}
        />
      ) : null}

      {featureEdit !== null ? (
        <FeatureEditorSheet
          projectId={projectId}
          feature={featureEdit === 'new' ? null : featureEdit}
          open
          onClose={() => setFeatureEdit(null)}
          onSaved={async () => {
            setFeatureEdit(null)
            await load()
          }}
        />
      ) : null}
    </section>
  )
}

interface FeatureCardProps {
  feature: EditableFeature
  projectId: string
  onChanged: () => Promise<void> | void
  onEditScenario: (s: EditableScenario) => void
  onAddScenario: () => void
  onEditFeature: () => void
}

function FeatureCard({
  feature,
  projectId,
  onChanged,
  onEditScenario,
  onAddScenario,
  onEditFeature,
}: FeatureCardProps) {
  const t = useTranslations('projects.overview.analysis.editor')
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const reviewedAll = useMemo(
    () =>
      feature.scenarios.length > 0 &&
      feature.scenarios.every((s) => s.reviewedAt),
    [feature.scenarios],
  )

  const toggleReviewed = () => {
    startTransition(async () => {
      const nextState = !feature.reviewedAt
      const res = await fetch(
        `/api/projects/${projectId}/features/${feature.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({ reviewed: nextState }),
        },
      )
      if (!res.ok) {
        toast.error(t('errors.update'))
        return
      }
      await onChanged()
    })
  }

  const deleteFeature = () => {
    if (!confirm(t('confirm.delete_feature', { name: feature.name }))) return
    startTransition(async () => {
      const res = await fetch(
        `/api/projects/${projectId}/features/${feature.id}`,
        {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'fetch' },
        },
      )
      if (!res.ok) {
        toast.error(t('errors.delete'))
        return
      }
      toast.success(t('feature_deleted'))
      await onChanged()
    })
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card',
        feature.reviewedAt ? 'border-fin-gain/40' : 'border-border',
      )}
    >
      <div className="flex items-start gap-2 p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? t('collapse') : t('expand')}
          className="mt-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 transition-transform',
              open && 'rotate-90',
            )}
          />
        </button>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-semibold">
              {feature.name}
            </span>
            <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] font-medium tabular-nums text-muted-foreground">
              {feature.scenarios.length}
            </span>
            {feature.source === 'manual' ? (
              <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                <UserPlus className="size-3" />
                {t('manual_badge')}
              </span>
            ) : null}
            {feature.reviewedAt ? (
              <span className="inline-flex items-center gap-1 rounded bg-fin-gain/10 px-1.5 py-0.5 text-[10px] font-medium text-fin-gain">
                <CheckCircle2 className="size-3" />
                {t('reviewed_badge')}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{feature.description}</p>
          {feature.reviewedAt && feature.reviewedBy ? (
            <ReviewedLine
              by={feature.reviewedBy.displayName}
              at={feature.reviewedAt}
            />
          ) : null}
          <div className="flex flex-wrap gap-1 pt-1">
            {(feature.paths as string[]).map((p) => (
              <code
                key={p}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {p}
              </code>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <IconBtn
            title={
              feature.reviewedAt ? t('unmark_reviewed') : t('mark_reviewed')
            }
            onClick={toggleReviewed}
            disabled={pending}
          >
            {feature.reviewedAt ? (
              <CheckCircle2 className="size-4 text-fin-gain" />
            ) : (
              <Circle className="size-4" />
            )}
          </IconBtn>
          <IconBtn title={t('edit')} onClick={onEditFeature}>
            <Pencil className="size-4" />
          </IconBtn>
          <IconBtn
            title={t('delete')}
            onClick={deleteFeature}
            disabled={pending}
            destructive
          >
            <Trash2 className="size-4" />
          </IconBtn>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border/40">
          <ul className="divide-y divide-border/40">
            {feature.scenarios.map((s) => (
              <ScenarioRow
                key={s.id}
                scenario={s}
                projectId={projectId}
                onChanged={onChanged}
                onEdit={() => onEditScenario(s)}
              />
            ))}
          </ul>
          <div className="p-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onAddScenario}
              className="text-muted-foreground"
            >
              <Plus className="size-4" />
              {t('add_scenario')}
            </Button>
          </div>
        </div>
      ) : null}

      {!open && feature.scenarios.length > 0 ? (
        <div className="border-t border-border/40 bg-muted/30 px-4 py-2">
          <div className="flex flex-wrap gap-1">
            {feature.scenarios.slice(0, 3).map((s) => (
              <span
                key={s.id}
                className="text-[11px] text-muted-foreground"
              >
                · {s.title}
              </span>
            ))}
            {feature.scenarios.length > 3 ? (
              <span className="text-[11px] text-muted-foreground/70">
                +{feature.scenarios.length - 3}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface ScenarioRowProps {
  scenario: EditableScenario
  projectId: string
  onChanged: () => Promise<void> | void
  onEdit: () => void
}

function ScenarioRow({
  scenario,
  projectId,
  onChanged,
  onEdit,
}: ScenarioRowProps) {
  const t = useTranslations('projects.overview.analysis.editor')
  const [pending, startTransition] = useTransition()

  const toggleReviewed = () => {
    startTransition(async () => {
      const next = !scenario.reviewedAt
      const res = await fetch(
        `/api/projects/${projectId}/ai-scenarios/${scenario.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({ reviewed: next }),
        },
      )
      if (!res.ok) {
        toast.error(t('errors.update'))
        return
      }
      await onChanged()
    })
  }

  const deleteScenario = () => {
    if (!confirm(t('confirm.delete_scenario', { title: scenario.title })))
      return
    startTransition(async () => {
      const res = await fetch(
        `/api/projects/${projectId}/ai-scenarios/${scenario.id}`,
        {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'fetch' },
        },
      )
      if (!res.ok) {
        toast.error(t('errors.delete'))
        return
      }
      toast.success(t('scenario_deleted'))
      await onChanged()
    })
  }

  return (
    <li
      className={cn(
        'flex items-start gap-3 p-4 transition-colors hover:bg-accent/20',
        scenario.reviewedAt && 'bg-fin-gain/[0.03]',
      )}
    >
      <button
        type="button"
        onClick={toggleReviewed}
        disabled={pending}
        aria-label={
          scenario.reviewedAt ? t('unmark_reviewed') : t('mark_reviewed')
        }
        className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        {scenario.reviewedAt ? (
          <CheckCircle2 className="size-4 text-fin-gain" />
        ) : (
          <Circle className="size-4" />
        )}
      </button>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-start gap-2">
          <PriorityBadge priority={scenario.priority} />
          {scenario.source === 'manual' ? (
            <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              <UserPlus className="size-3" />
              {t('manual_badge')}
            </span>
          ) : null}
          <p className="font-medium">{scenario.title}</p>
        </div>
        <p className="text-xs italic text-muted-foreground">
          {scenario.rationale}
        </p>
        {scenario.reviewedAt && scenario.reviewedBy ? (
          <ReviewedLine
            by={scenario.reviewedBy.displayName}
            at={scenario.reviewedAt}
          />
        ) : null}
        <ScenarioTestBlock test={scenario.latestTest} />
        {scenario.preconditions.length > 0 ||
        scenario.dataNeeded.length > 0 ? (
          <div className="grid gap-1 pt-1 sm:grid-cols-2">
            {scenario.preconditions.length > 0 ? (
              <MiniList
                heading={t('preconditions')}
                items={scenario.preconditions}
              />
            ) : null}
            {scenario.dataNeeded.length > 0 ? (
              <MiniList
                heading={t('data_needed')}
                items={scenario.dataNeeded}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <IconBtn title={t('edit')} onClick={onEdit}>
          <Pencil className="size-4" />
        </IconBtn>
        <IconBtn
          title={t('delete')}
          onClick={deleteScenario}
          disabled={pending}
          destructive
        >
          <Trash2 className="size-4" />
        </IconBtn>
      </div>
    </li>
  )
}

function ScenarioTestBlock({ test }: { test: LatestTest | null }) {
  const t = useTranslations('projects.overview.analysis.editor')
  const [open, setOpen] = useState(false)

  if (!test) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <FileCode2 className="size-3" />
        <span>{t('test.none')}</span>
      </div>
    )
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(test.code)
      toast.success(t('test.copied'))
    } catch {
      toast.error(t('test.copy_failed'))
    }
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 p-2 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/10"
      >
        <ChevronRight
          className={cn(
            'size-3.5 transition-transform',
            open && 'rotate-90',
          )}
        />
        <FileCode2 className="size-3.5" />
        <span className="flex-1">{t('test.generated_label')}</span>
        <span className="font-mono text-[10px] font-normal text-muted-foreground">
          <DateTime value={test.createdAt} />
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            copy()
          }}
          title={t('test.copy')}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Copy className="size-3.5" />
        </button>
      </button>
      {open ? (
        <pre className="max-h-80 overflow-auto border-t border-primary/20 bg-muted/40 p-3 font-mono text-[10px] leading-relaxed">
          <code>{test.code}</code>
        </pre>
      ) : null}
    </div>
  )
}

function ReviewedLine({ by, at }: { by: string; at: string }) {
  const t = useTranslations('projects.overview.analysis.editor')
  return (
    <p className="flex items-center gap-1 text-[11px] text-fin-gain/80">
      <CheckCircle2 className="size-3" />
      <span>{t('reviewed_by_prefix', { name: by })}</span>
      <DateTime value={at} />
    </p>
  )
}

function MiniList({
  heading,
  items,
}: {
  heading: string
  items: string[]
}) {
  return (
    <div className="rounded border border-border/60 bg-background/40 p-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {heading}
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-xs">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  )
}

function PriorityBadge({
  priority,
}: {
  priority: EditableScenario['priority']
}) {
  const colors: Record<EditableScenario['priority'], string> = {
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

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  destructive,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40',
        destructive && 'hover:bg-destructive/10 hover:text-destructive',
      )}
    >
      {children}
    </button>
  )
}

export type { ScenarioDraft, FeatureDraft }
