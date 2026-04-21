'use client'

import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  Play,
} from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { FeatureContextSheet } from './feature-context-sheet'

export type CoveragePriority = 'critical' | 'high' | 'normal' | 'low'

interface CodeFocusItem {
  path: string
  mode: 'focus' | 'ignore'
}

export interface FeatureCard {
  id: string
  externalId: string
  name: string
  description: string
  paths: string[]
  source: 'ai' | 'manual'
  businessRule: string | null
  testRestrictions: string | null
  codeFocus: CodeFocusItem[]
  expectedEnvVars: string[]
  coveragePriorities: CoveragePriority[]
  contextUpdatedAt: string | null
}

interface FeaturesResponse {
  features: FeatureCard[]
}

interface FreeScenariosResponse {
  items: Array<{ id: string; description: string; priority: number }>
}

type StatusFilter = 'all' | 'ready' | 'pending'

/**
 * Regra simples para considerar uma feature "pronta" pra gerar testes.
 * Baixo de propósito: QA só precisa ter pensado em algum aspecto de
 * negócio (regra, cenário livre, env var ou restrição).
 */
function isFeatureReady(
  f: FeatureCard,
  freeScenariosCount: number,
): boolean {
  return (
    (f.businessRule?.trim().length ?? 0) > 0 ||
    freeScenariosCount > 0 ||
    f.expectedEnvVars.length > 0 ||
    (f.testRestrictions?.trim().length ?? 0) > 0
  )
}

export function FeatureContextCards({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.discovery')
  const [features, setFeatures] = useState<FeatureCard[] | null>(null)
  const [freeCounts, setFreeCounts] = useState<Record<string, number>>({})
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<FeatureCard | null>(null)
  const [batchGenerating, startBatch] = useTransition()

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

    // Busca contagem de cenários livres por feature em paralelo. Sem
    // rota agregada — fazemos N requests simples e ficamos com o que
    // responder. Defensivo: falha retorna 0.
    const counts: Record<string, number> = {}
    await Promise.all(
      data.features.map(async (f) => {
        try {
          const r = await fetch(
            `/api/projects/${projectId}/features/${f.id}/free-scenarios`,
            { headers: { 'X-Requested-With': 'fetch' }, cache: 'no-store' },
          )
          if (!r.ok) return
          const body = (await r.json()) as FreeScenariosResponse
          counts[f.id] = body.items?.length ?? 0
        } catch {
          counts[f.id] = 0
        }
      }),
    )
    setFreeCounts(counts)
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
    const withReady = features.map((f) => ({
      feature: f,
      free: freeCounts[f.id] ?? 0,
      ready: isFeatureReady(f, freeCounts[f.id] ?? 0),
    }))
    return {
      all: withReady,
      ready: withReady.filter((x) => x.ready),
      pending: withReady.filter((x) => !x.ready),
    }
  }, [features, freeCounts])

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
    statusFilter === 'ready'
      ? derived.ready
      : statusFilter === 'pending'
        ? derived.pending
        : derived.all

  const generateBatch = () => {
    if (derived.ready.length === 0) return
    startBatch(async () => {
      toast.info(t('toast_generating', { count: derived.ready.length }))
      for (const { feature } of derived.ready) {
        try {
          const res = await fetch(
            `/api/projects/${projectId}/features/${feature.id}/generate-tests`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'fetch',
              },
              body: JSON.stringify({}),
            },
          )
          if (!res.ok) {
            toast.error(t('errors.generate', { name: feature.name }))
          }
        } catch {
          toast.error(t('errors.generate', { name: feature.name }))
        }
      }
      toast.success(t('toast_generate_done'))
      await load()
    })
  }

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
              {t('summary_ready', {
                ready: derived.ready.length,
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
              ready: derived.ready.length,
              pending: derived.pending.length,
            }}
          />
          <Button
            size="sm"
            onClick={generateBatch}
            disabled={derived.ready.length === 0 || batchGenerating}
            title={
              derived.ready.length === 0
                ? t('generate_tests_batch_disabled')
                : undefined
            }
          >
            {batchGenerating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {t('generate_tests_batch', { count: derived.ready.length })}
          </Button>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          {t(
            statusFilter === 'ready' ? 'badge_ready' : 'badge_pending',
          ).toString()}{' '}
          — 0
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map(({ feature, free, ready }) => (
            <FeatureCardRow
              key={feature.id}
              feature={feature}
              freeCount={free}
              ready={ready}
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
  counts: { all: number; ready: number; pending: number }
}) {
  const t = useTranslations('projects.overview.discovery')
  const items: Array<{ v: StatusFilter; labelKey: string; count: number }> = [
    { v: 'all', labelKey: 'filter_all', count: counts.all },
    { v: 'ready', labelKey: 'filter_ready', count: counts.ready },
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
  freeCount,
  ready,
  onClick,
}: {
  feature: FeatureCard
  freeCount: number
  ready: boolean
  onClick: () => void
}) {
  const t = useTranslations('projects.overview.discovery')

  const chips: string[] = []
  if (feature.businessRule && feature.businessRule.trim().length > 0) {
    chips.push(t('card_chip_business_rule'))
  }
  if (freeCount > 0) {
    chips.push(t('card_chip_scenarios', { count: freeCount }))
  }
  if (feature.testRestrictions && feature.testRestrictions.trim().length > 0) {
    chips.push(t('card_chip_restrictions'))
  }
  if (feature.expectedEnvVars.length > 0) {
    chips.push(
      t('card_chip_env_vars', { count: feature.expectedEnvVars.length }),
    )
  }
  if (feature.codeFocus.length > 0) {
    chips.push(
      t('card_chip_code_focus', { count: feature.codeFocus.length }),
    )
  }
  if (feature.coveragePriorities.length > 0) {
    chips.push(
      t('card_chip_priorities', {
        list: feature.coveragePriorities.join(' + '),
      }),
    )
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-label={t('open_editor')}
        className="group flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/20"
      >
        <div className="mt-0.5 shrink-0">
          {ready ? (
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
                ready
                  ? 'bg-fin-gain/10 text-fin-gain'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {ready ? t('badge_ready') : t('badge_pending')}
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
            {chips.length > 0
              ? chips.join(' · ')
              : t('card_summary_empty')}
          </p>
        </div>

        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>
    </li>
  )
}
