'use client'

import { CheckCircle2, ChevronRight, Circle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { DateTime } from '@/components/ui/date-time'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { FeatureContextSheet } from './feature-context-sheet'

export type CoveragePriority = 'critical' | 'high' | 'normal' | 'low'
export type ScenarioPriority = 'critical' | 'high' | 'normal' | 'low'

export interface AiScenario {
  description: string
  priority: ScenarioPriority
}

interface CodeFocusItem {
  path: string
  mode: 'focus' | 'ignore'
}

interface ApproverRef {
  id: string
  displayName: string
}

export interface FeatureCard {
  id: string
  externalId: string
  name: string
  description: string
  paths: string[]
  source: 'ai' | 'manual'
  // Legado — ainda vem no payload mas a UI não consome mais.
  businessRule: string | null
  testRestrictions: string | null
  codeFocus: CodeFocusItem[]
  expectedEnvVars: string[]
  coveragePriorities: CoveragePriority[]
  contextUpdatedAt: string | null
  // Novo modelo: IA escreve, QA aprova.
  aiUnderstanding: string | null
  aiScenarios: AiScenario[]
  approvedAt: string | null
  approvedBy: ApproverRef | null
}

interface FeaturesResponse {
  features: FeatureCard[]
}

type StatusFilter = 'all' | 'approved' | 'pending'

export function FeatureContextCards({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.discovery')
  const [features, setFeatures] = useState<FeatureCard[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<FeatureCard | null>(null)

  const load = async () => {
    const res = await fetch(`/api/projects/${projectId}/features`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
    if (!res.ok) {
      toast.error(t('errors.load'))
      return
    }
    const data = (await res.json()) as FeaturesResponse
    setFeatures(data.features)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Re-hydrata também quando a sheet é fechada pós-save
  const onChanged = async () => {
    await load()
  }

  const derived = useMemo(() => {
    if (!features) return null
    const withApproval = features.map((f) => ({
      feature: f,
      approved: f.approvedAt !== null,
    }))
    return {
      all: withApproval,
      approved: withApproval.filter((x) => x.approved),
      pending: withApproval.filter((x) => !x.approved),
    }
  }, [features])

  if (features === null || derived === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    )
  }

  if (features.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    )
  }

  const filtered =
    statusFilter === 'approved'
      ? derived.approved
      : statusFilter === 'pending'
        ? derived.pending
        : derived.all

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-lg font-semibold">
            {t('heading')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t('summary_total', { total: features.length })}
            {' · '}
            <span className="text-foreground">
              {t('summary_approved', {
                approved: derived.approved.length,
                total: features.length,
              })}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <StatusFilterToggle
            value={statusFilter}
            onChange={setStatusFilter}
            counts={{
              all: derived.all.length,
              approved: derived.approved.length,
              pending: derived.pending.length,
            }}
          />
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          {t(
            statusFilter === 'approved' ? 'approved_badge' : 'pending_badge',
          ).toString()}{' '}
          — 0
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map(({ feature, approved }) => (
            <FeatureCardRow
              key={feature.id}
              feature={feature}
              approved={approved}
              onClick={() => setSelected(feature)}
            />
          ))}
        </ul>
      )}

      <FeatureContextSheet
        feature={selected}
        projectId={projectId}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        onChanged={onChanged}
      />
    </section>
  )
}

function StatusFilterToggle({
  value,
  onChange,
  counts,
}: {
  value: StatusFilter
  onChange: (v: StatusFilter) => void
  counts: { all: number; approved: number; pending: number }
}) {
  const t = useTranslations('projects.overview.discovery')
  const items: Array<{ v: StatusFilter; labelKey: string; count: number }> = [
    { v: 'all', labelKey: 'filter_all', count: counts.all },
    { v: 'approved', labelKey: 'filter_approved', count: counts.approved },
    { v: 'pending', labelKey: 'filter_pending', count: counts.pending },
  ]
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-muted/40 p-0.5">
      {items.map((item) => (
        <button
          key={item.v}
          type="button"
          onClick={() => onChange(item.v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
            value === item.v
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(item.labelKey)}
          <span className="tabular-nums text-[10px] opacity-70">
            {item.count}
          </span>
        </button>
      ))}
    </div>
  )
}

function FeatureCardRow({
  feature,
  approved,
  onClick,
}: {
  feature: FeatureCard
  approved: boolean
  onClick: () => void
}) {
  const t = useTranslations('projects.overview.discovery')

  const hasUnderstanding =
    (feature.aiUnderstanding?.trim().length ?? 0) > 0
  const scenariosCount = feature.aiScenarios.length

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-label={t('open_editor')}
        className="group flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/20"
      >
        <div className="mt-0.5 shrink-0">
          {approved ? (
            <CheckCircle2 className="size-5 text-fin-gain" />
          ) : (
            <Circle className="size-5 text-muted-foreground/40" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-semibold">
              {feature.name}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                approved
                  ? 'bg-fin-gain/10 text-fin-gain'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {approved ? t('approved_badge') : t('pending_badge')}
            </span>
            {feature.source === 'manual' ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {t('badge_manual')}
              </span>
            ) : null}
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
            {feature.paths.length > 5 ? (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                +{feature.paths.length - 5}
              </span>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            {hasUnderstanding
              ? t('card_chip_understanding') +
                (scenariosCount > 0
                  ? ` · ${t('card_chip_scenarios', { count: scenariosCount })}`
                  : '')
              : t('card_summary_empty')}
          </p>

          {approved && feature.approvedAt && feature.approvedBy ? (
            <p className="flex items-center gap-1 text-[11px] text-fin-gain">
              <CheckCircle2 className="size-3" />
              <span>
                {t('approved_by_prefix', {
                  name: feature.approvedBy.displayName,
                })}
              </span>
              <DateTime value={feature.approvedAt} />
            </p>
          ) : null}
        </div>

        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>
    </li>
  )
}
