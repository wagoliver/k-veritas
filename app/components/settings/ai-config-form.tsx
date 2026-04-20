'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, CheckCircle2, Loader2, PlugZap } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { PasswordInput } from '@/components/auth/password-input'
import { cn } from '@/lib/utils'
import type { AIProvider } from '@/lib/db/schema'

const schema = z.object({
  provider: z.enum(['ollama', 'openai-compatible', 'anthropic']),
  baseUrl: z.string().trim().url(),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(500).optional().or(z.literal('')),
  clearApiKey: z.boolean().optional(),
  temperature: z.coerce.number().min(0).max(2),
  numCtx: z.coerce.number().int().min(512).max(131072),
  timeoutMs: z.coerce.number().int().min(5_000).max(1_800_000),
  anthropicApiKey: z.string().max(500).optional().or(z.literal('')),
  clearAnthropicApiKey: z.boolean().optional(),
  anthropicModel: z.string().trim().max(200).optional().or(z.literal('')),
})

type FormValues = z.infer<typeof schema>

export interface InitialAiConfig {
  provider: AIProvider
  baseUrl: string
  model: string
  hasApiKey: boolean
  temperature: number
  numCtx: number
  timeoutMs: number
  hasAnthropicKey: boolean
  anthropicModel: string | null
}

interface AiConfigFormProps {
  initial: InitialAiConfig | null
  canEdit: boolean
}

const PROVIDER_DEFAULTS: Record<AIProvider, Partial<InitialAiConfig>> = {
  ollama: {
    baseUrl: 'http://ollama:11434',
    model: 'qwen2.5:14b',
  },
  'openai-compatible': {
    baseUrl: 'http://host.docker.internal:1234',
    model: '',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5-20251001',
  },
}

export function AiConfigForm({ initial, canEdit }: AiConfigFormProps) {
  const t = useTranslations('settings.ai')
  const [saving, startSaving] = useTransition()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message: string
    models: string[]
  } | null>(null)
  const [hasSavedKey, setHasSavedKey] = useState(initial?.hasApiKey ?? false)
  const [hasSavedAnthropicKey, setHasSavedAnthropicKey] = useState(
    initial?.hasAnthropicKey ?? false,
  )

  const defaults: FormValues = {
    provider: initial?.provider ?? 'ollama',
    baseUrl: initial?.baseUrl ?? PROVIDER_DEFAULTS.ollama.baseUrl!,
    model: initial?.model ?? PROVIDER_DEFAULTS.ollama.model!,
    apiKey: '',
    clearApiKey: false,
    temperature: initial?.temperature ?? 0.3,
    numCtx: initial?.numCtx ?? 16384,
    timeoutMs: initial?.timeoutMs ?? 300_000,
    anthropicApiKey: '',
    clearAnthropicApiKey: false,
    anthropicModel:
      initial?.anthropicModel ?? 'claude-sonnet-4-5-20250929',
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })

  const provider = form.watch('provider')
  const clearApiKey = form.watch('clearApiKey')
  const clearAnthropicApiKey = form.watch('clearAnthropicApiKey')
  const providerIsAnthropic = provider === 'anthropic'

  const onProviderChange = (next: AIProvider) => {
    form.setValue('provider', next)
    const defs = PROVIDER_DEFAULTS[next]
    if (!initial || initial.provider !== next) {
      if (defs.baseUrl) form.setValue('baseUrl', defs.baseUrl)
      if (defs.model !== undefined) form.setValue('model', defs.model)
    }
    setTestResult(null)
  }

  const testConnection = async () => {
    const values = form.getValues()
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/orgs/current/ai-config/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({
          provider: values.provider,
          baseUrl: values.baseUrl,
          apiKey: values.apiKey ? values.apiKey : undefined,
          useSavedApiKey: Boolean(
            hasSavedKey && !values.apiKey && !values.clearApiKey,
          ),
        }),
      })
      if (!res.ok) {
        setTestResult({
          ok: false,
          message: `HTTP ${res.status}`,
          models: [],
        })
        return
      }
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        latencyMs?: number
        models?: string[]
      }
      if (!data.ok) {
        setTestResult({
          ok: false,
          message: t('test_fail', { error: data.error ?? 'unknown' }),
          models: [],
        })
        return
      }
      setTestResult({
        ok: true,
        message: t('test_ok', {
          latency: data.latencyMs ?? 0,
          count: data.models?.length ?? 0,
        }),
        models: data.models ?? [],
      })
    } catch (err) {
      setTestResult({
        ok: false,
        message: t('test_fail', {
          error: err instanceof Error ? err.message : 'unknown',
        }),
        models: [],
      })
    } finally {
      setTesting(false)
    }
  }

  const onSubmit = (values: FormValues) => {
    startSaving(async () => {
      try {
        const res = await fetch('/api/orgs/current/ai-config', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({
            provider: values.provider,
            baseUrl: values.baseUrl,
            model: values.model,
            apiKey: values.apiKey ? values.apiKey : undefined,
            clearApiKey: values.clearApiKey ?? false,
            temperature: values.temperature,
            numCtx: values.numCtx,
            timeoutMs: values.timeoutMs,
            anthropicApiKey: values.anthropicApiKey
              ? values.anthropicApiKey
              : undefined,
            clearAnthropicApiKey: values.clearAnthropicApiKey ?? false,
            anthropicModel: values.anthropicModel,
          }),
        })
        if (res.status === 403) {
          toast.error(t('errors.forbidden'))
          return
        }
        if (res.status === 429) {
          toast.error(t('errors.rate_limited'))
          return
        }
        if (!res.ok) {
          toast.error(t('errors.save'))
          return
        }
        const data = (await res.json()) as { config: InitialAiConfig | null }
        toast.success(t('saved'))
        setHasSavedKey(data.config?.hasApiKey ?? false)
        setHasSavedAnthropicKey(data.config?.hasAnthropicKey ?? false)
        form.reset({
          ...values,
          apiKey: '',
          clearApiKey: false,
          anthropicApiKey: '',
          clearAnthropicApiKey: false,
          anthropicModel:
            data.config?.anthropicModel ?? values.anthropicModel,
        })
      } catch {
        toast.error(t('errors.save'))
      }
    })
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-8"
        noValidate
      >
        <FormField
          control={form.control}
          name="provider"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('provider_label')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(v) => onProviderChange(v as AIProvider)}
                disabled={!canEdit}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="ollama">
                    {t('providers.ollama')}
                  </SelectItem>
                  <SelectItem value="anthropic">
                    {t('providers.anthropic')}
                  </SelectItem>
                  <SelectItem value="openai-compatible">
                    {t('providers.openai-compatible')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>{t('provider_hint')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-6 md:grid-cols-2">
          <FormField
            control={form.control}
            name="baseUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('base_url_label')}</FormLabel>
                <FormControl>
                  <Input {...field} disabled={!canEdit} spellCheck={false} />
                </FormControl>
                <FormDescription>{t('base_url_hint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="model"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('model_label')}</FormLabel>
                <FormControl>
                  <Input {...field} disabled={!canEdit} spellCheck={false} />
                </FormControl>
                <FormDescription>{t('model_hint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-3">
          <FormField
            control={form.control}
            name="apiKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('api_key_label')}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    autoComplete="off"
                    disabled={!canEdit || Boolean(clearApiKey)}
                    placeholder={hasSavedKey ? '••••••••' : ''}
                  />
                </FormControl>
                <FormDescription>
                  {hasSavedKey ? t('api_key_saved') : t('api_key_hint')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {hasSavedKey ? (
            <FormField
              control={form.control}
              name="clearApiKey"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(c) => field.onChange(Boolean(c))}
                      disabled={!canEdit}
                    />
                  </FormControl>
                  <FormLabel className="!mt-0 text-sm font-normal">
                    {t('api_key_clear')}
                  </FormLabel>
                </FormItem>
              )}
            />
          ) : null}
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <FormField
            control={form.control}
            name="temperature"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('temperature_label')}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.05"
                    min={0}
                    max={2}
                    disabled={!canEdit}
                    {...field}
                  />
                </FormControl>
                <FormDescription>{t('temperature_hint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="numCtx"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('num_ctx_label')}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="1024"
                    min={512}
                    max={131072}
                    disabled={!canEdit || provider !== 'ollama'}
                    {...field}
                  />
                </FormControl>
                <FormDescription>{t('num_ctx_hint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="timeoutMs"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('timeout_label')}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="5000"
                    min={5000}
                    max={1800000}
                    disabled={!canEdit}
                    {...field}
                  />
                </FormControl>
                <FormDescription>{t('timeout_hint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={testConnection}
            disabled={testing}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlugZap className="size-4" />
            )}
            {testing ? t('testing') : t('test_button')}
          </Button>

          <Button type="submit" disabled={saving || !canEdit}>
            {saving ? <Spinner /> : null}
            {saving ? t('saving') : t('save')}
          </Button>
        </div>

        <div className="mt-8 space-y-5 rounded-lg border border-border bg-muted/20 p-5">
          <header className="space-y-1">
            <h3 className="text-sm font-semibold">
              {t('anthropic_section.title')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('anthropic_section.subtitle')}
            </p>
          </header>

          {providerIsAnthropic ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
              {t('anthropic_section.reuse_hint')}
            </div>
          ) : null}

          <FormField
            control={form.control}
            name="anthropicApiKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('anthropic_section.api_key_label')}
                </FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    autoComplete="off"
                    disabled={!canEdit || Boolean(clearAnthropicApiKey)}
                    placeholder={
                      hasSavedAnthropicKey || providerIsAnthropic
                        ? '••••••••'
                        : 'sk-ant-...'
                    }
                  />
                </FormControl>
                <FormDescription>
                  {hasSavedAnthropicKey
                    ? t('anthropic_section.api_key_saved')
                    : providerIsAnthropic
                      ? t('anthropic_section.api_key_reused')
                      : t('anthropic_section.api_key_hint')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {hasSavedAnthropicKey ? (
            <FormField
              control={form.control}
              name="clearAnthropicApiKey"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(c) => field.onChange(Boolean(c))}
                      disabled={!canEdit}
                    />
                  </FormControl>
                  <FormLabel className="!mt-0 text-sm font-normal">
                    {t('anthropic_section.api_key_clear')}
                  </FormLabel>
                </FormItem>
              )}
            />
          ) : null}

          <FormField
            control={form.control}
            name="anthropicModel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('anthropic_section.model_label')}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={!canEdit}
                    spellCheck={false}
                    placeholder="claude-sonnet-4-5-20250929"
                  />
                </FormControl>
                <FormDescription>
                  {t('anthropic_section.model_hint')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {testResult ? (
          <div
            role="status"
            className={cn(
              'flex items-start gap-2 rounded-md border p-3 text-sm',
              testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-destructive/30 bg-destructive/10 text-destructive',
            )}
          >
            {testResult.ok ? (
              <CheckCircle2 className="size-4 shrink-0 translate-y-0.5" />
            ) : (
              <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
            )}
            <div className="flex-1 space-y-2">
              <p>{testResult.message}</p>
              {testResult.ok && testResult.models.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('available_models')}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {testResult.models.map((m) => (
                      <li key={m}>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => {
                            form.setValue('model', m, { shouldDirty: true })
                            toast.success(
                              `${t('pick_model')}: ${m}`,
                            )
                          }}
                          className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                        >
                          {m}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </form>
    </Form>
  )
}
