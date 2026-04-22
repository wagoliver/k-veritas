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
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  isPending: boolean
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
      [k: string]: unknown
    }
  >
}

export function ProjectScenarios({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.scenarios')
  const [features, setFeatures] = useState<ApprovedFeature[] | null>(null)
  const [loading, setLoading] = useState(true)

  // Cenários com job em voo (enfileirado ou rodando no codex). Quando o
  // latestTest aparece no payload, removemos o id daqui — o row para de
  // mostrar spinner. Polling roda enquanto o set tiver algo.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
        aiUnderstanding: f.aiUnderstanding,
        aiScenarios: Array.isArray(f.aiScenarios)
          ? f.aiScenarios.map((s) => ({
              ...s,
              // Defensivo: payloads antigos podem não trazer isPending.
              isPending: Boolean((s as ScenarioWithTest).isPending),
            }))
          : [],
        approvedAt: f.approvedAt,
      }))
    setFeatures(approved)
    setLoading(false)

    // Sincroniza pendingIds com o backend:
    //   - adiciona os que o server reporta como in-flight (sobrevive a
    //     reload da página)
    //   - remove os que já têm latestTest (geração concluída)
    setPendingIds((prev) => {
      const next = new Set(prev)
      for (const f of approved) {
        for (const s of f.aiScenarios) {
          if (s.isPending) next.add(s.id)
          else if (s.latestTest) next.delete(s.id)
          // cenário sem isPending e sem latestTest: está no pendingIds só
          // se a QA acabou de disparar e o job ainda não virou pending no
          // banco — mantém até próxima poll.
        }
      }
      return next
    })

    return approved
  }, [projectId, t])

  useEffect(() => {
    load()
  }, [load])

  // Poll enquanto há jobs em voo. Cancela quando set esvazia.
  useEffect(() => {
    if (pendingIds.size === 0) {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      return
    }
    pollTimerRef.current = setTimeout(() => {
      void load()
    }, 3000)
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [pendingIds, load, features])

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
    }
  }, [features])

  const markPending = (ids: string[]) => {
    setPendingIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })
  }

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

  return (
    <section className="space-y-3">
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
        {pendingIds.size > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            <Loader2 className="size-3 animate-spin" />
            {t('pending_count', { count: pendingIds.size })}
          </span>
        ) : null}
      </header>

      <div className="space-y-2">
        {features.map((feature) => (
          <FeatureBlock
            key={feature.id}
            projectId={projectId}
            feature={feature}
            pendingIds={pendingIds}
            markPending={markPending}
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
  pendingIds,
  markPending,
  onChanged,
}: {
  projectId: string
  feature: ApprovedFeature
  pendingIds: Set<string>
  markPending: (ids: string[]) => void
  onChanged: () => Promise<ApprovedFeature[] | null>
}) {
  const t = useTranslations('projects.overview.scenarios')
  // Cards retraídos por default, EXCETO se a feature tiver cenários com
  // job em voo — aí auto-expande pra QA ver o progresso sem um clique.
  const [expanded, setExpanded] = useState(() =>
    feature.aiScenarios.some((s) => s.isPending),
  )
  const [localScenarios, setLocalScenarios] = useState(feature.aiScenarios)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(
    new Set(),
  )

  useEffect(() => {
    setLocalScenarios(feature.aiScenarios)
    // Limpa seleção se algum cenário sumiu ou recebeu teste novo.
    setSelected((prev) => {
      const nextIds = new Set(feature.aiScenarios.map((s) => s.id))
      const next = new Set<string>()
      for (const id of prev) if (nextIds.has(id)) next.add(id)
      return next
    })
  }, [feature.aiScenarios])

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
      isPending: false,
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
    setSelected((prev) => {
      const n = new Set(prev)
      n.delete(id)
      return n
    })
    void persistScenarios(next)
  }

  const saveBlurOnDescription = async (id: string) => {
    const original = feature.aiScenarios.find((s) => s.id === id)
    const now = localScenarios.find((s) => s.id === id)
    if (!original || !now) return
    if (original.description === now.description) return
    await persistScenarios(localScenarios)
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelectable = localScenarios
    .filter((s) => !pendingIds.has(s.id))
    .map((s) => s.id)
  const allSelected =
    allSelectable.length > 0 &&
    allSelectable.every((id) => selected.has(id))

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev)
        for (const id of allSelectable) next.delete(id)
        return next
      }
      const next = new Set(prev)
      for (const id of allSelectable) next.add(id)
      return next
    })
  }

  const enqueueOne = async (
    scenarioId: string,
  ): Promise<{ ok: boolean; status?: number }> => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/features/${feature.id}/scenarios/${scenarioId}/generate-test`,
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

  const generateSelected = async () => {
    const ids = Array.from(selected).filter(
      (id) =>
        !pendingIds.has(id) &&
        localScenarios.some((s) => s.id === id),
    )
    if (ids.length === 0) return
    setSubmitting(true)
    markPending(ids)
    setSelected(new Set())
    const results = await Promise.all(ids.map((id) => enqueueOne(id)))
    const ok = results.filter((r) => r.ok).length
    const hasAnthropicMissing = results.some(
      (r) => r.status === 400,
    )
    const hasRate = results.some((r) => r.status === 429)
    if (hasAnthropicMissing) {
      toast.error(t('errors.anthropic_missing'))
    } else if (hasRate) {
      toast.error(t('errors.rate_limited'))
    } else {
      toast.success(t('toast_enqueued', { count: ok }))
    }
    setSubmitting(false)
    await onChanged()
  }

  const regenerate = async (scenarioId: string) => {
    setRegeneratingIds((prev) => new Set(prev).add(scenarioId))
    const { ok, status } = await enqueueOne(scenarioId)
    setRegeneratingIds((prev) => {
      const next = new Set(prev)
      next.delete(scenarioId)
      return next
    })
    if (!ok) {
      if (status === 429) toast.error(t('errors.rate_limited'))
      else if (status === 400) toast.error(t('errors.anthropic_missing'))
      else toast.error(t('errors.generate'))
      return
    }
    markPending([scenarioId])
    toast.success(t('toast_enqueued', { count: 1 }))
    await onChanged()
  }

  const generatedCount = localScenarios.filter((s) => s.latestTest).length
  const total = localScenarios.length
  const selectedCount = selected.size
  // Pending local considera tanto a flag do backend (sobrevive F5) quanto
  // o pendingIds setado no momento do clique (antes do job virar row no
  // banco).
  const pendingInFeature = localScenarios.filter(
    (s) => s.isPending || pendingIds.has(s.id),
  ).length
  const progressPct =
    total > 0 ? Math.round((generatedCount / total) * 100) : 0
  const allDone = total > 0 && generatedCount === total
  const progressBarColor = allDone
    ? 'bg-fin-gain'
    : generatedCount > 0
      ? 'bg-primary'
      : 'bg-muted-foreground/30'

  return (
    <div
      className={cn(
        'surface-card overflow-hidden rounded-xl transition-all',
        pendingInFeature > 0 && 'ring-1 ring-primary/40',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-3 border-b border-border/60 px-4 py-2.5 transition-colors',
          pendingInFeature > 0 ? 'bg-primary/5' : 'bg-card/60',
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <div className="shrink-0">
            {expanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-sm font-semibold">
                {feature.name}
              </span>
              {allDone ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-fin-gain" />
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                {generatedCount}/{total}
              </span>
              {pendingInFeature > 0 ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                  title={t('pending_tooltip')}
                >
                  <Loader2 className="size-3 animate-spin" />
                  {t('feature_pending_label', { count: pendingInFeature })}
                </span>
              ) : null}
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
            {total > 0 ? (
              <div
                className="h-1 w-full overflow-hidden rounded-full bg-muted/60"
                role="progressbar"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    progressBarColor,
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            ) : null}
          </div>
        </button>
        {expanded && selectedCount > 0 ? (
          <Button
            type="button"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              void generateSelected()
            }}
            disabled={submitting || saving}
            className="shrink-0"
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {t('generate_selected', { count: selectedCount })}
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <div className="space-y-2 px-4 py-3">
          {localScenarios.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('empty_scenarios')}
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={saving || submitting || allSelectable.length === 0}
                  aria-label={t('select_all')}
                />
                <span className="text-[11px] text-muted-foreground">
                  {t('select_all')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {localScenarios.map((s) => (
                  <ScenarioRow
                    key={s.id}
                    scenario={s}
                    selected={selected.has(s.id)}
                    pending={pendingIds.has(s.id)}
                    regenerating={regeneratingIds.has(s.id)}
                    disabled={saving || submitting}
                    onToggleSelect={() => toggleSelect(s.id)}
                    onChangePriority={(p) => editPriority(s.id, p)}
                    onChangeDescription={(d) => editDescription(s.id, d)}
                    onBlurDescription={() => saveBlurOnDescription(s.id)}
                    onRemove={() => removeScenario(s.id)}
                    onRegenerate={() => regenerate(s.id)}
                  />
                ))}
              </ul>
            </>
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
              disabled={saving || submitting}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addScenario}
              disabled={saving || submitting || draft.trim().length < 4}
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
  selected,
  pending,
  regenerating,
  disabled,
  onToggleSelect,
  onChangePriority,
  onChangeDescription,
  onBlurDescription,
  onRemove,
  onRegenerate,
}: {
  scenario: ScenarioWithTest
  selected: boolean
  pending: boolean
  regenerating: boolean
  disabled: boolean
  onToggleSelect: () => void
  onChangePriority: (p: Priority) => void
  onChangeDescription: (d: string) => void
  onBlurDescription: () => void
  onRemove: () => void
  onRegenerate: () => void
}) {
  const t = useTranslations('projects.overview.scenarios')
  const [showCode, setShowCode] = useState(false)

  const hasTest = scenario.latestTest !== null
  const inFlight = pending || regenerating

  const copyCode = async () => {
    if (!scenario.latestTest) return
    try {
      await navigator.clipboard.writeText(scenario.latestTest.code)
      toast.success(t('toast_copied'))
    } catch {
      toast.error(t('errors.copy'))
    }
  }

  // Stripe lateral — principal sinalizador visual de estado:
  // azul = gerando, verde = pronto, neutro = pendente de geração.
  const stripeClass = inFlight
    ? 'border-l-primary bg-primary/5'
    : hasTest
      ? 'border-l-fin-gain'
      : 'border-l-border'

  return (
    <li
      className={cn(
        'group rounded-lg border border-l-[3px] px-3 py-2 transition-colors',
        stripeClass,
        inFlight && 'ring-1 ring-primary/25',
        !inFlight && 'border-border bg-background/40',
      )}
      aria-busy={inFlight}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          disabled={disabled || inFlight}
          aria-label={t('select_scenario')}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled || inFlight}
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
          readOnly={inFlight}
          className={cn(
            'flex-1 resize-none border-none bg-transparent p-0 text-xs leading-snug shadow-none focus-visible:ring-0',
            // Sobrescreve o min-h-24 do Textarea base: altura colapsa pra 1
            // linha e cresce via field-sizing-content quando o texto quebra.
            '!min-h-0 field-sizing-content',
            inFlight && 'text-muted-foreground',
          )}
          disabled={disabled}
        />

        {inFlight ? (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
            title={t('pending_tooltip')}
          >
            <Loader2 className="size-3 animate-spin" />
            {t('pending_label')}
          </span>
        ) : hasTest ? (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={disabled}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
            title={t('regenerate_tooltip')}
            aria-label={t('regenerate')}
          >
            <RefreshCw className="size-3.5" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
          disabled={disabled || inFlight}
          aria-label={t('remove_scenario')}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {inFlight ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-primary">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
          {t('pending_hint')}
        </p>
      ) : null}

      {hasTest && scenario.latestTest ? (
        <div className="mt-1.5">
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
            <div className="mt-1.5 space-y-1">
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={copyCode}
                  className="h-6 gap-1.5 px-2 text-[11px]"
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
