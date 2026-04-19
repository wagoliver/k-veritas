'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DateTime } from '@/components/ui/date-time'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { AnalysisEditor } from './analysis-editor'

type Provider = 'ollama' | 'anthropic' | 'openai-compatible'

interface Scenario {
  title: string
  rationale: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  preconditions?: string[]
  dataNeeded?: string[]
}

interface Feature {
  id: string
  name: string
  description: string
  paths: string[]
  scenarios: Scenario[]
}

interface Analysis {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  model: string
  provider: string
  summary: string | null
  inferredLocale: string | null
  features: Feature[]
  error: string | null
  tokensIn: number | null
  tokensOut: number | null
  durationMs: number | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export function ProjectAnalysis({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.analysis')
  const [analysis, setAnalysis] = useState<Analysis | null | undefined>(
    undefined,
  )
  const [running, startRun] = useTransition()
  const [tick, setTick] = useState(0)
  const [modelOverride, setModelOverride] = useState<string | null>(null)
  const [orgProvider, setOrgProvider] = useState<Provider>('ollama')
  const [orgBaseUrl, setOrgBaseUrl] = useState<string | null>(null)
  const [orgDefaultModel, setOrgDefaultModel] = useState<string | null>(null)

  // Carrega a config de IA da org pra saber qual provider/baseUrl/modelo.
  // O picker usa provider+baseUrl pra consultar modelos reais no provider.
  useEffect(() => {
    let cancelled = false
    fetch('/api/orgs/current/ai-config', {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          config?: {
            provider?: string
            baseUrl?: string
            model?: string
          } | null
        } | null) => {
          if (cancelled) return
          const p = data?.config?.provider as Provider | undefined
          if (p === 'ollama' || p === 'anthropic' || p === 'openai-compatible') {
            setOrgProvider(p)
          }
          setOrgBaseUrl(data?.config?.baseUrl ?? null)
          setOrgDefaultModel(data?.config?.model ?? null)
        },
      )
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const load = async (): Promise<Analysis | null | undefined> => {
    const res = await fetch(`/api/projects/${projectId}/ai/analyze`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as { analysis: Analysis | null }

    // Se temos um stub optimistic (id='optimistic') e o server ainda não
    // criou o row de verdade (ou nunca criou por erro), NÃO sobrescreve com
    // null — senão a UI pisca de volta pro empty state. O trigger() limpa o
    // stub explicitamente quando o POST termina (sucesso ou erro).
    setAnalysis((prev) => {
      if (prev?.id === 'optimistic' && data.analysis === null) return prev
      return data.analysis
    })
    return data.analysis
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Polling enquanto há análise em andamento — reidrata tokens/duracao.
  useEffect(() => {
    const s = analysis?.status
    if (s !== 'pending' && s !== 'running') return
    const intv = setInterval(() => load(), 2000)
    return () => clearInterval(intv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.status, projectId])

  // Tick de 1s para a UI atualizar o tempo decorrido sem novo fetch.
  useEffect(() => {
    const s = analysis?.status
    if (s !== 'pending' && s !== 'running') return
    const intv = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(intv)
  }, [analysis?.status])

  const cancel = async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/ai/analyze/cancel`,
        {
          method: 'POST',
          headers: { 'X-Requested-With': 'fetch' },
        },
      )
      if (!res.ok) {
        toast.error(t('errors.generic'))
        return
      }
      toast.success(t('cancelled'))
      await load()
    } catch {
      toast.error(t('errors.network'))
    }
  }

  const trigger = () => {
    // Guarda contra double-click: se já está em voo (local ou servidor), ignora
    if (running || isInFlight) return

    // Optimistic UI: troca o empty-state imediatamente por uma linha "running"
    // stub antes mesmo do POST partir. Sem gap visual, sem oportunidade de
    // clicar 2x.
    const now = new Date().toISOString()
    setAnalysis({
      id: 'optimistic',
      status: 'running',
      model: analysis?.model ?? '…',
      provider: analysis?.provider ?? '…',
      summary: null,
      inferredLocale: null,
      features: [],
      error: null,
      tokensIn: null,
      tokensOut: 0,
      durationMs: 0,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
    })

    startRun(async () => {
      const clearOptimistic = () => {
        setAnalysis((prev) => (prev?.id === 'optimistic' ? null : prev))
      }
      try {
        const postPromise = fetch(`/api/projects/${projectId}/ai/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify(
            modelOverride ? { model: modelOverride } : {},
          ),
        })
        // Em ~500ms o row real já está inserido no banco — substitui o stub
        // pelo registro real. Se o POST falhou antes do INSERT, load() não
        // sobrescreve o stub com null (vide lógica de preservação em load()),
        // mas o clearOptimistic abaixo cuida disso quando o POST retorna.
        setTimeout(() => {
          void load()
        }, 500)

        const res = await postPromise

        if (res.status === 429) {
          toast.error(t('errors.rate_limited'))
          clearOptimistic()
          await load()
          return
        }
        if (res.status === 409) {
          // Pode ser "análise já rodando" (mais recente venceu) OU "sem crawl"
          const payload = (await res
            .json()
            .catch(() => ({}))) as { code?: string }
          if (payload.code === 'no_crawl_available') {
            toast.error(t('errors.no_crawl'))
          } else {
            toast.error(t('errors.conflict'))
          }
          clearOptimistic()
          await load()
          return
        }
        if (res.status >= 500) {
          const payload = (await res
            .json()
            .catch(() => ({}))) as { detail?: string }
          toast.error(
            t('errors.failed', { reason: payload.detail ?? `HTTP ${res.status}` }),
          )
          clearOptimistic()
          await load()
          return
        }
        const data = (await res.json().catch(() => ({}))) as {
          status?: 'completed' | 'failed'
          error?: string
        }
        if (data.status === 'completed') {
          toast.success(t('success'))
        } else if (data.status === 'failed') {
          toast.error(t('errors.failed', { reason: data.error ?? '—' }))
        }
        await load()
      } catch {
        toast.error(t('errors.network'))
        clearOptimistic()
        await load()
      }
    })
  }

  const isInFlight =
    analysis?.status === 'pending' || analysis?.status === 'running'

  const liveElapsedSeconds = analysis?.startedAt
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(analysis.startedAt).getTime()) / 1000),
      )
    : analysis?.createdAt
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(analysis.createdAt).getTime()) / 1000,
          ),
        )
      : 0

  // referência a `tick` garante re-render a cada segundo durante running
  void tick

  if (analysis === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  }

  if (analysis === null) {
    return (
      <div className="surface-card glow-teal-sm flex flex-col items-center gap-4 rounded-xl px-8 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-6" />
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold">
            {t('empty.title')}
          </h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {t('empty.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={trigger} disabled={running} size="lg">
            {running ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {t('empty.cta')}
          </Button>
          <ModelPicker
            value={modelOverride}
            onChange={setModelOverride}
            provider={orgProvider}
            baseUrl={orgBaseUrl}
            defaultModel={orgDefaultModel}
            t={t}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header com metadata do run */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {analysis.status === 'completed' ? (
            <CheckCircle2 className="size-5 text-fin-gain" />
          ) : analysis.status === 'failed' ? (
            <AlertTriangle className="size-5 text-destructive" />
          ) : (
            <Loader2 className="size-5 animate-spin text-primary" />
          )}
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-3">
              <span className="font-mono">
                {analysis.provider}/{analysis.model}
              </span>
              {isInFlight ? null : analysis.durationMs ? (
                <span className="tabular-nums">
                  {(analysis.durationMs / 1000).toFixed(1)}s
                </span>
              ) : null}
              {!isInFlight &&
              (analysis.tokensIn || analysis.tokensOut) ? (
                <span className="tabular-nums">
                  {analysis.tokensIn ?? 0} in · {analysis.tokensOut ?? 0} out
                </span>
              ) : null}
            </div>
            {isInFlight ? (
              <div className="space-y-0.5">
                <div className="font-medium text-primary tabular-nums">
                  {analysis.status === 'pending'
                    ? t('progress.pending')
                    : (analysis.tokensOut ?? 0) === 0
                      ? t('progress.waiting_model', {
                          seconds: liveElapsedSeconds,
                        })
                      : t('progress.generating', {
                          tokens: analysis.tokensOut ?? 0,
                          seconds: liveElapsedSeconds,
                        })}
                </div>
                {(analysis.tokensOut ?? 0) === 0 &&
                liveElapsedSeconds > 20 ? (
                  <div className="text-[11px] text-muted-foreground">
                    {t('progress.waiting_hint')}
                  </div>
                ) : null}
              </div>
            ) : (
              <DateTime
                value={analysis.createdAt}
                dateStyle="medium"
                timeStyle="short"
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isInFlight && liveElapsedSeconds > 20 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={cancel}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <X className="size-4" />
              {t('cancel')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={trigger}
            disabled={running || isInFlight}
          >
            {running ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Zap className="size-4" />
            )}
            {t('reanalyze')}
          </Button>
          <ModelPicker
            value={modelOverride}
            onChange={setModelOverride}
            provider={orgProvider}
            baseUrl={orgBaseUrl}
            defaultModel={orgDefaultModel}
            t={t}
            compact
          />
        </div>
      </div>

      {analysis.status === 'failed' ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">
            {t('errors.failed_title')}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {analysis.error ?? '—'}
          </p>
        </div>
      ) : null}

      {analysis.summary ? (
        <section className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" />
            {t('summary')}
          </h3>
          <p className="text-sm leading-relaxed">{analysis.summary}</p>
          {analysis.inferredLocale ? (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              locale: {analysis.inferredLocale}
            </p>
          ) : null}
        </section>
      ) : null}

      <AnalysisEditor projectId={projectId} />
    </div>
  )
}

type TFn = ReturnType<typeof useTranslations<'projects.overview.analysis'>>

function ModelPicker({
  value,
  onChange,
  provider,
  baseUrl,
  defaultModel,
  t,
  compact = false,
}: {
  value: string | null
  onChange: (v: string | null) => void
  provider: Provider
  baseUrl: string | null
  defaultModel: string | null
  t: TFn
  compact?: boolean
}) {
  const [models, setModels] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const label = value ?? t('model_picker.default_label')

  // Lazy-fetch: consulta a API do provider real (via nosso endpoint /test)
  // só quando o dropdown é aberto pela primeira vez. Depois reusa cache.
  const loadModels = async () => {
    if (loaded || loading || !baseUrl) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/orgs/current/ai-config/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({
          provider,
          baseUrl,
          useSavedApiKey: true,
        }),
      })
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        setLoaded(true)
        return
      }
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        models?: string[]
      }
      if (!data.ok) {
        setError(data.error ?? 'unknown')
        setLoaded(true)
        return
      }
      setModels(data.models ?? [])
      setLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown')
      setLoaded(true)
    } finally {
      setLoading(false)
    }
  }

  const promptCustom = () => {
    const v = window.prompt(
      t('model_picker.custom_prompt', { provider }),
      value ?? '',
    )
    if (v === null) return
    const trimmed = v.trim()
    onChange(trimmed.length > 0 ? trimmed : null)
  }

  const listedModels = (models ?? []).filter((m) => m !== defaultModel)

  return (
    <DropdownMenu onOpenChange={(open) => open && loadModels()}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'sm' : 'default'}
          className="gap-1.5 text-xs text-muted-foreground"
        >
          <Sparkles className="size-3.5" />
          {label}
          <ChevronRight className="size-3 rotate-90 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-80 overflow-y-auto">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('model_picker.heading')}
          </span>
          <span className="text-[10px] font-normal text-muted-foreground">
            {t('model_picker.provider_label', { provider })}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => onChange(null)}
          className={cn('flex-col items-start gap-0.5', !value && 'bg-accent')}
        >
          <span className="font-medium">
            {t('model_picker.default_label')}
            {defaultModel ? (
              <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                ({defaultModel})
              </span>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('model_picker.default_hint')}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('model_picker.loading')}
          </div>
        ) : error ? (
          <div className="px-2 py-3 text-xs text-destructive">
            {t('model_picker.load_failed', { error: error })}
          </div>
        ) : listedModels.length === 0 && loaded ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            {t('model_picker.empty')}
          </div>
        ) : (
          listedModels.slice(0, 30).map((name) => (
            <DropdownMenuItem
              key={name}
              onSelect={() => onChange(name)}
              className={cn(
                'font-mono text-xs',
                value === name && 'bg-accent',
              )}
            >
              {name}
            </DropdownMenuItem>
          ))
        )}
        {listedModels.length > 30 ? (
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            {t('model_picker.truncated', { count: listedModels.length - 30 })}
          </div>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            promptCustom()
          }}
          className="flex-col items-start gap-0.5"
        >
          <span className="font-medium">
            {t('model_picker.custom_label')}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('model_picker.custom_hint')}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

