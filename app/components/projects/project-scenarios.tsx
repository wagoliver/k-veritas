'use client'

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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

interface Scenario {
  id: string
  description: string
  priority: Priority
}

interface ApprovedFeature {
  id: string
  name: string
  paths: string[]
  aiScenarios: Scenario[]
  approvedAt: string | null
}

interface FeaturesResponse {
  features: Array<
    ApprovedFeature & {
      [k: string]: unknown
    }
  >
}

export function ProjectScenarios({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.scenarios')
  const [features, setFeatures] = useState<ApprovedFeature[] | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (): Promise<ApprovedFeature[] | null> => {
    const res = await fetch(`/api/projects/${projectId}/features`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
    if (!res.ok) {
      toast.error(t('errors.load'))
      return null
    }
    const data = (await res.json()) as FeaturesResponse
    const approved = data.features
      .filter((f) => f.approvedAt !== null)
      .map((f) => ({
        id: f.id,
        name: f.name,
        paths: f.paths,
        aiScenarios: Array.isArray(f.aiScenarios)
          ? f.aiScenarios.map((s) => ({
              id: s.id,
              description: s.description,
              priority: s.priority,
            }))
          : [],
        approvedAt: f.approvedAt,
      }))
    setFeatures(approved)
    setLoading(false)
    return approved
  }, [projectId, t])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-24" />
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

  const totalScenarios = features.reduce(
    (sum, f) => sum + f.aiScenarios.length,
    0,
  )

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-lg font-semibold">
            {t('heading')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t('summary', {
              features: features.length,
              scenarios: totalScenarios,
            })}
          </p>
        </div>
      </header>

      <div className="space-y-2">
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
  onChanged: () => Promise<ApprovedFeature[] | null>
}) {
  const t = useTranslations('projects.overview.scenarios')
  const [expanded, setExpanded] = useState(false)
  const [localScenarios, setLocalScenarios] = useState(feature.aiScenarios)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setLocalScenarios(feature.aiScenarios)
  }, [feature.aiScenarios])

  const persistScenarios = async (scenarios: Scenario[]) => {
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
    const newScenario: Scenario = {
      id: crypto.randomUUID(),
      description: v,
      priority: 'normal',
    }
    const next = [...localScenarios, newScenario]
    setLocalScenarios(next)
    setDraft('')
    void persistScenarios(next)
  }

  const removeScenario = async (id: string) => {
    if (!confirm(t('confirm_remove_scenario'))) return
    const next = localScenarios.filter((s) => s.id !== id)
    setLocalScenarios(next)
    await persistScenarios(next)
    await onChanged()
  }

  const saveBlurOnDescription = async (id: string) => {
    const original = feature.aiScenarios.find((s) => s.id === id)
    const now = localScenarios.find((s) => s.id === id)
    if (!original || !now) return
    if (original.description === now.description) return
    await persistScenarios(localScenarios)
  }

  const total = localScenarios.length

  return (
    <div className="surface-card overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 border-b border-border/60 bg-card/60 px-4 py-2.5 text-left transition-colors hover:bg-accent/20"
        aria-expanded={expanded}
      >
        <div className="shrink-0">
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-semibold">
              {feature.name}
            </span>
            <CheckCircle2 className="size-3.5 shrink-0 text-fin-gain" />
            <span className="text-[11px] text-muted-foreground">
              {t('scenarios_count', { count: total })}
            </span>
            {feature.paths.slice(0, 3).map((p) => (
              <span
                key={p}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {p}
              </span>
            ))}
            {feature.paths.length > 3 ? (
              <span className="text-[10px] text-muted-foreground/70">
                +{feature.paths.length - 3}
              </span>
            ) : null}
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="space-y-2 px-4 py-3">
          {localScenarios.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('empty_scenarios')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {localScenarios.map((s) => (
                <ScenarioRow
                  key={s.id}
                  scenario={s}
                  disabled={saving}
                  onChangePriority={(p) => editPriority(s.id, p)}
                  onChangeDescription={(d) => editDescription(s.id, d)}
                  onBlurDescription={() => saveBlurOnDescription(s.id)}
                  onRemove={() => removeScenario(s.id)}
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
              disabled={saving}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addScenario}
              disabled={saving || draft.trim().length < 4}
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
  disabled,
  onChangePriority,
  onChangeDescription,
  onBlurDescription,
  onRemove,
}: {
  scenario: Scenario
  disabled: boolean
  onChangePriority: (p: Priority) => void
  onChangeDescription: (d: string) => void
  onBlurDescription: () => void
  onRemove: () => void
}) {
  const t = useTranslations('projects.overview.scenarios')

  return (
    <li className="group rounded-lg border border-border bg-background/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                'inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60',
                PRIORITY_CLASSES[scenario.priority],
              )}
              title={t('priority_tooltip')}
            >
              {t(`priority.${scenario.priority}`)}
              <ChevronDown className="size-2.5 opacity-70" />
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
          className={cn(
            'flex-1 resize-none border-none bg-transparent p-0 text-xs leading-snug shadow-none focus-visible:ring-0',
            '!min-h-0 field-sizing-content',
          )}
          disabled={disabled}
        />

        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
          disabled={disabled}
          aria-label={t('remove_scenario')}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  )
}
