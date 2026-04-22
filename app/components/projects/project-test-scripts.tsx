'use client'

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  Loader2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import { DateTime } from '@/components/ui/date-time'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Priority = 'critical' | 'high' | 'normal' | 'low'

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

interface Scenario {
  id: string
  description: string
  priority: Priority
  latestTest: LatestTest | null
}

interface Feature {
  id: string
  name: string
  paths: string[]
  aiScenarios: Scenario[]
  approvedAt: string | null
}

interface FeaturesResponse {
  features: Array<Feature & { [k: string]: unknown }>
}

export function ProjectTestScripts({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.test_scripts')
  const [features, setFeatures] = useState<Feature[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(async () => {
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
    // Só features aprovadas com pelo menos 1 cenário tendo teste gerado.
    const withTests = data.features
      .filter((f) => f.approvedAt !== null)
      .map((f) => ({
        id: f.id,
        name: f.name,
        paths: f.paths,
        aiScenarios: Array.isArray(f.aiScenarios) ? f.aiScenarios : [],
        approvedAt: f.approvedAt,
      }))
      .filter((f) => f.aiScenarios.some((s) => s.latestTest !== null))
    setFeatures(withTests)
    setLoading(false)
  }, [projectId, t])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    if (!features) return null
    let totalTests = 0
    for (const f of features) {
      for (const s of f.aiScenarios) {
        if (s.latestTest) totalTests += 1
      }
    }
    return { features: features.length, tests: totalTests }
  }, [features])

  const download = async () => {
    setDownloading(true)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/test-scenarios/download`,
        {
          headers: { 'X-Requested-With': 'fetch' },
        },
      )
      if (!res.ok) {
        toast.error(t('errors.download'))
        return
      }
      const blob = await res.blob()
      // Extrai filename do Content-Disposition; fallback genérico.
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] ?? 'tests.zip'

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(t('toast_downloaded'))
    } catch {
      toast.error(t('errors.download'))
    } finally {
      setDownloading(false)
    }
  }

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
      <div className="surface-card flex flex-col items-center gap-3 rounded-xl px-8 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileCode2 className="size-6" />
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
                tests: stats.tests,
              })}
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          onClick={download}
          disabled={downloading}
        >
          {downloading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {t('download_zip')}
        </Button>
      </header>

      <div className="space-y-2">
        {features.map((feature) => (
          <FeatureBlock key={feature.id} feature={feature} />
        ))}
      </div>
    </section>
  )
}

function FeatureBlock({ feature }: { feature: Feature }) {
  const t = useTranslations('projects.overview.test_scripts')
  const [expanded, setExpanded] = useState(false)

  const withTests = feature.aiScenarios.filter((s) => s.latestTest !== null)
  const total = feature.aiScenarios.length
  const generated = withTests.length

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
              {t('feature_count', { generated, total })}
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
        <div className="space-y-3 px-4 py-3">
          {withTests.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('empty_feature')}
            </p>
          ) : (
            <ul className="space-y-3">
              {withTests.map((s) => (
                <ScenarioTestRow key={s.id} scenario={s} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

function ScenarioTestRow({ scenario }: { scenario: Scenario }) {
  const t = useTranslations('projects.overview.test_scripts')
  const [open, setOpen] = useState(false)

  const copyCode = async () => {
    if (!scenario.latestTest) return
    try {
      await navigator.clipboard.writeText(scenario.latestTest.code)
      toast.success(t('toast_copied'))
    } catch {
      toast.error(t('errors.copy'))
    }
  }

  if (!scenario.latestTest) return null

  return (
    <li className="rounded-lg border border-l-[3px] border-l-fin-gain border-border bg-background/40 px-3 py-2">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
            PRIORITY_CLASSES[scenario.priority],
          )}
        >
          {t(`priority.${scenario.priority}`)}
        </span>
        <span className="flex-1 text-xs leading-snug">
          {scenario.description}
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          <span>{open ? t('hide_code') : t('show_code')}</span>
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

      {open ? (
        <div className="mt-2">
          <CodeBlock code={scenario.latestTest.code} language="typescript" />
        </div>
      ) : null}
    </li>
  )
}
