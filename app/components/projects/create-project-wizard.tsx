'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
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
    targetUrl: z
      .string()
      .trim()
      .url({ message: 'errors.invalid_url' })
      .refine((v) => v.startsWith('http://') || v.startsWith('https://'), {
        message: 'errors.invalid_url',
      }),
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
    if (v.requiresAuth) {
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

  const defaultTargetLocale: TargetLocale = (TARGET_LOCALES as readonly string[]).includes(
    uiLocale,
  )
    ? (uiLocale as TargetLocale)
    : 'pt-BR'

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      targetUrl: '',
      requiresAuth: false,
      loginUrl: '',
      username: '',
      password: '',
      targetLocale: defaultTargetLocale,
    },
  })

  const onSubmit = async (values: Values) => {
    setSubmitting(true)
    try {
      const body = {
        name: values.name,
        targetUrl: values.targetUrl,
        authKind: values.requiresAuth ? 'form' : 'none',
        authForm: values.requiresAuth
          ? {
              loginUrl: values.loginUrl,
              username: values.username,
              password: values.password,
            }
          : undefined,
        targetLocale: values.targetLocale,
        scenarios: [] as string[],
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
        const field = payload?.fields?.targetUrl ?? payload?.fields?.loginUrl
        if (field === 'private_host_blocked') {
          toast.error(t('errors.private_host'))
          return
        }
        if (field === 'invalid_url' || field === 'invalid_protocol') {
          toast.error(t('errors.invalid_url'))
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
