'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Code2, Globe, Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
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
import { Textarea } from '@/components/ui/textarea'
import { useRouter } from '@/lib/i18n/navigation'
import { cn } from '@/lib/utils'
import { PasswordInput } from '@/components/auth/password-input'

const TARGET_LOCALES = ['pt-BR', 'en-US', 'es-ES', 'fr-FR', 'de-DE'] as const
type TargetLocale = (typeof TARGET_LOCALES)[number]

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, { message: 'errors.min_2' })
      .max(80, { message: 'errors.max_80' }),
    sourceType: z.enum(['url', 'repo']),
    targetUrl: z.string().trim().optional().or(z.literal('')),
    repoUrl: z.string().trim().optional().or(z.literal('')),
    repoBranch: z.string().trim().optional().or(z.literal('')),
    businessContext: z.string().trim().max(20_000).optional().or(z.literal('')),
    requiresAuth: z.boolean(),
    loginUrl: z
      .string()
      .trim()
      .url({ message: 'errors.invalid_url' })
      .optional()
      .or(z.literal('')),
    username: z.string().trim().optional().or(z.literal('')),
    password: z.string().optional().or(z.literal('')),
    targetLocale: z.enum(TARGET_LOCALES),
  })
  .superRefine((v, ctx) => {
    if (v.sourceType === 'url') {
      if (!v.targetUrl) {
        ctx.addIssue({
          code: 'custom',
          message: 'errors.required',
          path: ['targetUrl'],
        })
      } else if (!/^https?:\/\//.test(v.targetUrl)) {
        ctx.addIssue({
          code: 'custom',
          message: 'errors.invalid_url',
          path: ['targetUrl'],
        })
      }
    }
    if (v.sourceType === 'repo' && !v.repoUrl) {
      ctx.addIssue({
        code: 'custom',
        message: 'errors.required',
        path: ['repoUrl'],
      })
    }
    // Auth só se aplica quando sourceType=url (o crawler é que precisa logar).
    if (v.sourceType === 'url' && v.requiresAuth) {
      if (!v.loginUrl) {
        ctx.addIssue({
          code: 'custom',
          message: 'errors.required',
          path: ['loginUrl'],
        })
      }
      if (!v.username) {
        ctx.addIssue({
          code: 'custom',
          message: 'errors.required',
          path: ['username'],
        })
      }
      if (!v.password) {
        ctx.addIssue({
          code: 'custom',
          message: 'errors.required',
          path: ['password'],
        })
      }
    }
  })

type Values = z.infer<typeof schema>

export function CreateProjectWizard() {
  const t = useTranslations('projects.wizard')
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const uiLocale = useLocale()

  const defaultTargetLocale: TargetLocale = (
    TARGET_LOCALES as readonly string[]
  ).includes(uiLocale)
    ? (uiLocale as TargetLocale)
    : 'pt-BR'

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      sourceType: 'repo',
      targetUrl: '',
      repoUrl: '',
      repoBranch: 'main',
      businessContext: '',
      requiresAuth: false,
      loginUrl: '',
      username: '',
      password: '',
      targetLocale: defaultTargetLocale,
    },
  })

  const sourceType = form.watch('sourceType')

  const onSubmit = async (values: Values) => {
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: values.name,
        sourceType: values.sourceType,
        targetLocale: values.targetLocale,
        scenarios: [] as string[],
        businessContext: values.businessContext || undefined,
      }

      if (values.sourceType === 'url') {
        body.targetUrl = values.targetUrl
        body.authKind = values.requiresAuth ? 'form' : 'none'
        if (values.requiresAuth) {
          body.authForm = {
            loginUrl: values.loginUrl,
            username: values.username,
            password: values.password,
          }
        }
      } else {
        body.repoUrl = values.repoUrl
        body.repoBranch = values.repoBranch || 'main'
        body.authKind = 'none'
      }

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify(body),
      })

      if (res.status === 429) {
        toast.error(t('errors.rate_limited'))
        return
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        const fields = payload?.fields as Record<string, string> | undefined
        const reason =
          fields?.targetUrl ?? fields?.loginUrl ?? fields?.repoUrl
        if (reason === 'private_host_blocked') {
          toast.error(t('errors.private_host'))
          return
        }
        if (reason === 'invalid_url' || reason === 'invalid_protocol') {
          toast.error(t('errors.invalid_url'))
          return
        }
        if (reason === 'only_github_supported') {
          toast.error(t('errors.only_github'))
          return
        }
        if (reason === 'invalid_repo_url') {
          toast.error(t('errors.invalid_repo_url'))
          return
        }
        toast.error(t('errors.generic'))
        return
      }

      const created = (await res.json()) as { id: string }
      toast.success(t('success'))
      router.push(`/projects/${created.id}`)
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="surface-card space-y-5 rounded-xl p-6"
          noValidate
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('step1.name_label')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoFocus
                    placeholder={t('step1.name_placeholder')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="sourceType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('step1.source_type_label')}</FormLabel>
                <div className="grid grid-cols-2 gap-3">
                  <SourceCard
                    icon={<Code2 className="size-5" />}
                    title={t('step1.source_type_options.repo_title')}
                    description={t('step1.source_type_options.repo_desc')}
                    selected={field.value === 'repo'}
                    onClick={() => field.onChange('repo')}
                  />
                  <SourceCard
                    icon={<Globe className="size-5" />}
                    title={t('step1.source_type_options.url_title')}
                    description={t('step1.source_type_options.url_desc')}
                    selected={field.value === 'url'}
                    onClick={() => field.onChange('url')}
                  />
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {sourceType === 'url' ? (
            <FormField
              control={form.control}
              name="targetUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('step1.url_label')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="url"
                      inputMode="url"
                      placeholder="https://staging.acme.com"
                    />
                  </FormControl>
                  <FormDescription>{t('step1.url_hint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <>
              <FormField
                control={form.control}
                name="repoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('step1.repo_url_label')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="https://github.com/owner/repo"
                      />
                    </FormControl>
                    <FormDescription>
                      {t('step1.repo_url_hint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="repoBranch"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('step1.repo_branch_label')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="main" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="businessContext"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('step1.business_context_label')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={6}
                        placeholder={t('step1.business_context_placeholder')}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('step1.business_context_hint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          <FormField
            control={form.control}
            name="targetLocale"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('step1.target_locale_label')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {TARGET_LOCALES.map((loc) => (
                      <SelectItem key={loc} value={loc}>
                        {t(`step1.target_locale_options.${loc}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t('step1.target_locale_hint')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {sourceType === 'url' ? (
            <>
              <FormField
                control={form.control}
                name="requiresAuth"
                render={({ field }) => (
                  <FormItem>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
                        field.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40 hover:bg-accent/30',
                      )}
                    >
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="mt-0.5"
                        />
                      </FormControl>
                      <div className="space-y-0.5">
                        <span className="block text-sm font-medium">
                          {t('step1.auth_label')}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {t('step1.auth_hint')}
                        </p>
                      </div>
                    </label>
                  </FormItem>
                )}
              />

              {form.watch('requiresAuth') ? (
                <div className="animate-fade-up space-y-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
                  <FormField
                    control={form.control}
                    name="loginUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('step1.login_url_label')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="url"
                            placeholder="https://staging.acme.com/login"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('step1.username_label')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              autoComplete="off"
                              placeholder="qa@acme.com"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('step1.password_label')}</FormLabel>
                          <FormControl>
                            <PasswordInput {...field} autoComplete="off" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('step1.credentials_note')}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push('/projects')}
              disabled={submitting}
            >
              {t('buttons.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('buttons.create')}
            </Button>
          </div>
        </form>
      </Form>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        {t('next_step_hint')}
      </p>
    </div>
  )
}

function SourceCard({
  icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/40 hover:bg-accent/30',
      )}
    >
      <span className="text-primary">{icon}</span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  )
}
