'use client'

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import { DateTime } from '@/components/ui/date-time'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type Priority = 'critical' | 'high' | 'normal' | 'low'

const PRIORITIES: Priority[] = ['critical', 'high', 'normal', 'low']

const PRIORITY_CLASSES: Record<Priority, string> = {
  critical: 'bg-destructive/15 text-destructive',
  high: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  normal: 'bg-primary/15 text-primary',
  low: 'bg-muted text-muted-foreground',
}

interface LatestTest {
  code: string
  model: string | null
  createdAt: string
  createdBy: string | null
}

interface ScenarioWithTest {
  id: string
  description: string
  priority: Priority
  latestTest: LatestTest | null
}

interface ApprovedFeature {
  id: string
  name: string
  paths: string[]
  aiUnderstanding: string | null
  aiScenarios: ScenarioWithTest[]
  approvedAt: string | null
}

interface FeaturesResponse {
  features: Array<
    ApprovedFeature & {
      // Campos que não usamos aqui mas vêm do endpoint
      [k: string]: unknown
    }
  >
}

export function ProjectScenarios({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.scenarios')
  const [features, setFeatures] = useState<ApprovedFeature[] | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const res = await fetch(`/api/projects/${projectId}/features`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
    if (!res.ok) {
      toast.error(t('errors.load'))
      setLoading(false)
      return
    }
    const data = (await res.json()) as FeaturesResponse
    const approved = data.features
      .filter((f) => f.approvedAt !== null)
      .map((f) => ({
        id: f.id,
        name: f.name,
        paths: f.paths,
        aiUnderstanding: f.aiUnderstanding,
        aiScenarios: Array.isArray(f.aiScenarios) ? f.aiScenarios : [],
        approvedAt: f.approvedAt,
      }))
    setFeatures(approved)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const stats = useMemo(() => {
    if (!features) return null
    let totalScenarios = 0
    let generated = 0
    for (const f of features) {
      for (const s of f.aiScenarios) {
        totalScenarios += 1
        if (s.latestTest) generated += 1
      }
    }
    return {
      features: features.length,
      scenarios: totalScenarios,
      generated,
      pending: totalScenarios - generated,
    }
  }, [features])

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    )
  }

  if (!features || features.length === 0) {
    return (
      <div className="surface-card glow-teal-sm flex flex-col items-center gap-3 rounded-xl px-8 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ClipboardCheck className="size-6" />
        </div>
        <h3 className="font-display text-lg font-semibold">
          {t('empty_title')}
        </h3>
        <p className="max-w-md text-sm text-muted-foreground">
          {t('empty_description')}
        </p>
      </div>
    )
  }

  const generateAllPending = async () => {
    const pending: Array<{ featureId: string; scenarioId: string }> = []
    for (const f of features) {
      for (const s of f.aiScenarios) {
        if (!s.latestTest) pending.push({ featureId: f.id, scenarioId: s.id })
      }
    }
    if (pending.length === 0) {
      toast.info(t('toast_all_done'))
      return
    }
    toast.info(t('toast_batch_starting', { count: pending.length }))
    let ok = 0
    for (let i = 0; i < pending.length; i++) {
      const { featureId, scenarioId } = pending[i]
      try {
        const res = await fetch(
          `/api/projects/${projectId}/features/${featureId}/scenarios/${scenarioId}/generate-test`,
          {
            method: 'POST',
            headers: { 'X-Requested-With': 'fetch' },
          },
        )
        if (res.ok) ok += 1
      } catch {
        // segue próximo
      }
    }
    toast.success(t('toast_batch_done', { ok, total: pending.length }))
    await load()
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-lg font-semibold">
            {t('heading')}
          </h2>
          {stats ? (
            <p className="text-xs text-muted-foreground">
              {t('summary', {
                features: stats.features,
                scenarios: stats.scenarios,
                generated: stats.generated,
              })}
            </p>
          ) : null}
        </div>
        {stats && stats.pending > 0 ? (
          <Button size="sm" onClick={generateAllPending}>
            <Play className="size-3.5" />
            {t('batch_all_pending', { count: stats.pending })}
          </Button>
        ) : null}
      </header>

      <div className="space-y-3">
        {features.map((feature) => (
          <FeatureBlock
            key={feature.id}
            projectId={projectId}
            feature={feature}
            onChanged={load}
          />
        ))}
      </div>
    </section>
  )
}

function FeatureBlock({
  projectId,
  feature,
  onChanged,
}: {
  projectId: string
  feature: ApprovedFeature
  onChanged: () => Promise<void>
}) {
  const t = useTranslations('projects.overview.scenarios')
  const [expanded, setExpanded] = useState(true)
  const [localScenarios, setLocalScenarios] = useState(feature.aiScenarios)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set())
  const [batching, setBatching] = useState(false)

  useEffect(() => {
    setLocalScenarios(feature.aiScenarios)
  }, [feature.aiScenarios])

  const pendingCount = localScenarios.filter((s) => !s.latestTest).length

  const persistScenarios = async (scenarios: ScenarioWithTest[]) => {
    setSaving(true)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/features/${feature.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({
            aiScenarios: scenarios.map(({ id, description, priority }) => ({
              id,
              description: description.trim(),
              priority,
            })),
          }),
        },
      )
      if (!res.ok) {
        toast.error(t('errors.save'))
      }
    } finally {
      setSaving(false)
    }
  }

  const editDescription = (id: string, description: string) => {
    setLocalScenarios((prev) =>
      prev.map((s) => (s.id === id ? { ...s, description } : s)),
    )
  }

  const editPriority = (id: string, priority: Priority) => {
    setLocalScenarios((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, priority } : s))
      void persistScenarios(next)
      return next
    })
  }

  const addScenario = () => {
    const v = draft.trim()
    if (v.length < 4) return
    const newScenario: ScenarioWithTest = {
      id: crypto.randomUUID(),
      description: v,
      priority: 'normal',
      latestTest: null,
    }
    const next = [...localScenarios, newScenario]
    setLocalScenarios(next)
    setDraft('')
    void persistScenarios(next)
  }

  const removeScenario = (id: string) => {
    if (!confirm(t('confirm_remove_scenario'))) return
    const next = localScenarios.filter((s) => s.id !== id)
    setLocalScenarios(next)
    void persistScenarios(next)
  }

  const saveBlurOnDescription = async (id: string) => {
    const original = feature.aiScenarios.find((s) => s.id === id)
    const now = localScenarios.find((s) => s.id === id)
    if (!original || !now) return
    if (original.description === now.description) return
    await persistScenarios(localScenarios)
  }

  const generateOne = async (scenarioId: string) => {
    setGeneratingIds((prev) => new Set(prev).add(scenarioId))
    try {
      const res = await fetch(
        `/api/projects/${projectId}/features/${feature.id}/scenarios/${scenarioId}/generate-test`,
        {
          method: 'POST',
          headers: { 'X-Requested-With': 'fetch' },
        },
      )
      if (!res.ok) {
        if (res.status === 409) {
          toast.error(t('errors.not_approved'))
        } else if (res.status === 429) {
          toast.error(t('errors.rate_limited'))
        } else {
          toast.error(t('errors.generate'))
        }
        return
      }
      toast.success(t('toast_generated'))
      await onChanged()
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev)
        next.delete(scenarioId)
        return next
      })
    }
  }

  const generateAllInFeature = async () => {
    const pending = localScenarios.filter((s) => !s.latestTest)
    if (pending.length === 0) {
      toast.info(t('toast_all_done'))
      return
    }
    setBatching(true)
    toast.info(t('toast_batch_starting', { count: pending.length }))
    let ok = 0
    for (const s of pending) {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/features/${feature.id}/scenarios/${s.id}/generate-test`,
          {
            method: 'POST',
            headers: { 'X-Requested-With': 'fetch' },
          },
        )
        if (res.ok) ok += 1
      } catch {
        // continue
      }
    }
    toast.success(t('toast_batch_done', { ok, total: pending.length }))
    setBatching(false)
    await onChanged()
  }

  return (
    <div className="surface-card overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 border-b border-border/60 bg-card/60 px-4 py-3 text-left transition-colors hover:bg-accent/20"
        aria-expanded={expanded}
      >
        <div className="mt-0.5 shrink-0">
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-semibold">
              {feature.name}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-fin-gain/10 px-2 py-0.5 text-[10px] font-medium text-fin-gain">
              <CheckCircle2 className="size-3" />
              {t('approved_badge')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('scenarios_count', {
                count: localScenarios.length,
                generated: localScenarios.filter((s) => s.latestTest).length,
              })}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {feature.paths.slice(0, 5).map((p) => (
              <span
                key={p}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
        {pendingCount > 0 && expanded ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              void generateAllInFeature()
            }}
            disabled={batching || saving}
            className="shrink-0"
          >
            {batching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {t('batch_feature', { count: pendingCount })}
          </Button>
        ) : null}
      </button>

      {expanded ? (
        <div className="space-y-3 px-4 py-4">
          {localScenarios.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('empty_scenarios')}
            </p>
          ) : (
            <ul className="space-y-3">
              {localScenarios.map((s) => (
                <ScenarioRow
                  key={s.id}
                  scenario={s}
                  generating={generatingIds.has(s.id)}
                  disabled={saving || batching}
                  onChangePriority={(p) => editPriority(s.id, p)}
                  onChangeDescription={(d) => editDescription(s.id, d)}
                  onBlurDescription={() => saveBlurOnDescription(s.id)}
                  onRemove={() => removeScenario(s.id)}
                  onGenerate={() => generateOne(s.id)}
                />
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addScenario()
                }
              }}
              placeholder={t('add_scenario_placeholder')}
              disabled={saving || batching}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addScenario}
              disabled={saving || batching || draft.trim().length < 4}
            >
              {t('add_scenario')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ScenarioRow({
  scenario,
  generating,
  disabled,
  onChangePriority,
  onChangeDescription,
  onBlurDescription,
  onRemove,
  onGenerate,
}: {
  scenario: ScenarioWithTest
  generating: boolean
  disabled: boolean
  onChangePriority: (p: Priority) => void
  onChangeDescription: (d: string) => void
  onBlurDescription: () => void
  onRemove: () => void
  onGenerate: () => void
}) {
  const t = useTranslations('projects.overview.scenarios')
  const [showCode, setShowCode] = useState(false)

  const hasTest = scenario.latestTest !== null

  const copyCode = async () => {
    if (!scenario.latestTest) return
    try {
      await navigator.clipboard.writeText(scenario.latestTest.code)
      toast.success(t('toast_copied'))
    } catch {
      toast.error(t('errors.copy'))
    }
  }

  return (
    <li className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-start gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                'mt-1 inline-flex shrink-0 cursor-pointer items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-opacity hover:opacity-80 disabled:cursor-not-allowed',
                PRIORITY_CLASSES[scenario.priority],
              )}
            >
              {t(`priority.${scenario.priority}`)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            {PRIORITIES.map((p) => (
              <DropdownMenuItem
                key={p}
                onSelect={() => onChangePriority(p)}
                className={cn(
                  'text-xs',
                  scenario.priority === p && 'bg-accent',
                )}
              >
                <span
                  className={cn(
                    'mr-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                    PRIORITY_CLASSES[p],
                  )}
                >
                  {t(`priority.${p}`)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Textarea
          value={scenario.description}
          onChange={(e) => onChangeDescription(e.target.value)}
          onBlur={onBlurDescription}
          rows={1}
          className="flex-1 resize-none border-none bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
          disabled={disabled}
        />

        <Button
          type="button"
          size="sm"
          variant={hasTest ? 'ghost' : 'default'}
          onClick={onGenerate}
          disabled={disabled || generating}
          className="shrink-0"
          title={hasTest ? t('regenerate_tooltip') : t('generate_tooltip')}
        >
          {generating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : hasTest ? (
            <RefreshCw className="size-3.5" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {hasTest ? t('regenerate') : t('generate')}
        </Button>

        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 p-1 opacity-60 hover:opacity-100"
          disabled={disabled || generating}
          aria-label={t('remove_scenario')}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {hasTest && scenario.latestTest ? (
        <div className="mt-2 space-y-2">
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            aria-expanded={showCode}
          >
            {showCode ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <span>{showCode ? t('hide_code') : t('show_code')}</span>
            <span className="text-muted-foreground/70">·</span>
            <span>
              <DateTime value={scenario.latestTest.createdAt} />
            </span>
            {scenario.latestTest.model ? (
              <>
                <span className="text-muted-foreground/70">·</span>
                <span className="font-mono">{scenario.latestTest.model}</span>
              </>
            ) : null}
          </button>

          {showCode ? (
            <div className="space-y-1.5">
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={copyCode}
                  className="h-7 gap-1.5 px-2 text-[11px]"
                >
                  <Copy className="size-3" />
                  {t('copy')}
                </Button>
              </div>
              <CodeBlock code={scenario.latestTest.code} language="typescript" />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
