'use client'

import { ChevronRight, Loader2, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type AiProvider = 'ollama' | 'anthropic' | 'openai-compatible'

interface ModelPickerProps {
  /** Valor atual. null = usar o padrão da org. */
  value: string | null
  onChange: (v: string | null) => void
  provider: AiProvider
  baseUrl: string | null
  defaultModel: string | null
  compact?: boolean
}

/**
 * Dropdown que lista modelos do provider em runtime (via /ai-config/test),
 * permite escolher "Padrão da org" (null), um modelo da lista, ou digitar
 * um nome custom.
 *
 * Extraído de project-analysis.tsx pra ser reusado em outras telas
 * (code-analysis, geração de testes por feature).
 */
export function ModelPicker({
  value,
  onChange,
  provider,
  baseUrl,
  defaultModel,
  compact = false,
}: ModelPickerProps) {
  const t = useTranslations('projects.overview.analysis.model_picker')
  const [models, setModels] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const label = value ?? t('default_label')

  const loadModels = useCallback(async () => {
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
  }, [loaded, loading, baseUrl, provider])

  const promptCustom = () => {
    const v = window.prompt(t('custom_prompt', { provider }), value ?? '')
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
            {t('heading')}
          </span>
          <span className="text-[10px] font-normal text-muted-foreground">
            {t('provider_label', { provider })}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => onChange(null)}
          className={cn('flex-col items-start gap-0.5', !value && 'bg-accent')}
        >
          <span className="font-medium">
            {t('default_label')}
            {defaultModel ? (
              <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                ({defaultModel})
              </span>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('default_hint')}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('loading')}
          </div>
        ) : error ? (
          <div className="px-2 py-3 text-xs text-destructive">
            {t('load_failed', { error })}
          </div>
        ) : listedModels.length === 0 && loaded ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            {t('empty')}
          </div>
        ) : (
          listedModels.slice(0, 30).map((name) => (
            <DropdownMenuItem
              key={name}
              onSelect={() => onChange(name)}
              className={cn('font-mono text-xs', value === name && 'bg-accent')}
            >
              {name}
            </DropdownMenuItem>
          ))
        )}
        {listedModels.length > 30 ? (
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            {t('truncated', { count: listedModels.length - 30 })}
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
          <span className="font-medium">{t('custom_label')}</span>
          <span className="text-xs text-muted-foreground">
            {t('custom_hint')}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Hook que busca a config de IA da org uma vez por sessão e cacheia.
 * Usado pelo ModelPicker pra saber provider/baseUrl/defaultModel sem
 * exigir que cada tela faça seu próprio fetch.
 *
 * Pro codex/code-first, sempre força `provider='anthropic'` e usa o
 * `anthropic_model` dedicado (não o provider principal da org).
 */
export interface AnthropicConfig {
  provider: 'anthropic'
  baseUrl: string
  defaultModel: string | null
  hasKey: boolean
}

export function useAnthropicConfig(): AnthropicConfig | null {
  const [cfg, setCfg] = useState<AnthropicConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/orgs/current/ai-config', {
      headers: { 'X-Requested-With': 'fetch' },
    })
      .then(async (res) => {
        if (!res.ok) return
        const body = (await res.json()) as {
          config: {
            provider?: string
            baseUrl?: string
            model?: string
            hasApiKey?: boolean
            hasAnthropicKey?: boolean
            anthropicModel?: string | null
          } | null
        }
        if (cancelled || !body.config) return
        setCfg({
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: body.config.anthropicModel ?? null,
          hasKey: Boolean(body.config.hasAnthropicKey),
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return cfg
}

/**
 * Hook que persiste a escolha de modelo em localStorage, com chave
 * específica por projeto + ação (ex.: "model:proj-abc:code-analysis").
 * Retorna [value, setValue] similar a useState.
 */
export function usePersistedModel(
  storageKey: string,
): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(null)

  // Hidrata do localStorage uma vez no mount. Fica de fora do SSR.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const v = window.localStorage.getItem(storageKey)
      if (v && v.length > 0) setValue(v)
    } catch {
      // localStorage pode estar desabilitado (Safari private, etc.)
    }
  }, [storageKey])

  const update = useCallback(
    (v: string | null) => {
      setValue(v)
      if (typeof window === 'undefined') return
      try {
        if (v === null) window.localStorage.removeItem(storageKey)
        else window.localStorage.setItem(storageKey, v)
      } catch {
        // idem
      }
    },
    [storageKey],
  )

  return [value, update]
}
