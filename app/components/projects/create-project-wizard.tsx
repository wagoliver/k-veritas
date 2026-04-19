'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
import { Label } from '@/components/ui/label'
import { useRouter } from '@/lib/i18n/navigation'
import { PasswordInput } from '@/components/auth/password-input'

const step1Schema = z
  .object({
    name: z.string().trim().min(2, { message: 'errors.min_2' }).max(80, {
      message: 'errors.max_80',
    }),
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

const step2Schema = z.object({
  description: z.string().trim().max(4000).optional(),
  scenarios: z
    .string()
    .trim()
    .min(4, { message: 'errors.min_scenarios' })
    .refine(
      (v) =>
        v
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean).length >= 1,
      { message: 'errors.min_scenarios' },
    ),
})

type Step1 = z.infer<typeof step1Schema>
type Step2 = z.infer<typeof step2Schema>

export function CreateProjectWizard() {
  const t = useTranslations('projects.wizard')
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [step1Data, setStep1Data] = useState<Step1 | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const form1 = useForm<Step1>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      name: '',
      targetUrl: '',
      requiresAuth: false,
      loginUrl: '',
      username: '',
      password: '',
    },
  })

  const form2 = useForm<Step2>({
    resolver: zodResolver(step2Schema),
    defaultValues: { description: '', scenarios: '' },
  })

  const onStep1 = (values: Step1) => {
    setStep1Data(values)
    setStep(2)
  }

  const onStep2 = async (values: Step2) => {
    if (!step1Data) return
    setSubmitting(true)
    try {
      const scenarios = values.scenarios
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)

      const body = {
        name: step1Data.name,
        targetUrl: step1Data.targetUrl,
        description: values.description || undefined,
        authKind: step1Data.requiresAuth ? 'form' : 'none',
        authForm: step1Data.requiresAuth
          ? {
              loginUrl: step1Data.loginUrl,
              username: step1Data.username,
              password: step1Data.password,
            }
          : undefined,
        scenarios,
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

      <div className="mb-6 flex items-center gap-3 text-sm">
        <StepPill active={step === 1} done={step > 1} label={t('step_labels.basics')} n={1} />
        <div className="h-px flex-1 bg-border" />
        <StepPill active={step === 2} done={false} label={t('step_labels.context')} n={2} />
      </div>

      {step === 1 ? (
        <Form {...form1}>
          <form
            onSubmit={form1.handleSubmit(onStep1)}
            className="surface-card space-y-5 rounded-xl p-6"
            noValidate
          >
            <FormField
              control={form1.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('step1.name_label')}</FormLabel>
                  <FormControl>
                    <Input {...field} autoFocus placeholder={t('step1.name_placeholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form1.control}
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
              control={form1.control}
              name="requiresAuth"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-start gap-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-0.5">
                      <Label className="font-medium">{t('step1.auth_label')}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t('step1.auth_hint')}
                      </p>
                    </div>
                  </div>
                </FormItem>
              )}
            />

            {form1.watch('requiresAuth') ? (
              <div className="space-y-4 rounded-lg border border-border bg-background/40 p-4">
                <FormField
                  control={form1.control}
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
                    control={form1.control}
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
                    control={form1.control}
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
              <Button type="button" variant="ghost" onClick={() => router.push('/projects')}>
                {t('buttons.cancel')}
              </Button>
              <Button type="submit">
                {t('buttons.next')}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </form>
        </Form>
      ) : (
        <Form {...form2}>
          <form
            onSubmit={form2.handleSubmit(onStep2)}
            className="surface-card space-y-5 rounded-xl p-6"
            noValidate
          >
            <FormField
              control={form2.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('step2.description_label')}</FormLabel>
                  <FormControl>
                    <textarea
                      {...field}
                      rows={4}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                      placeholder={t('step2.description_placeholder')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('step2.description_hint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form2.control}
              name="scenarios"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('step2.scenarios_label')}</FormLabel>
                  <FormControl>
                    <textarea
                      {...field}
                      rows={6}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                      placeholder={t('step2.scenarios_placeholder')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('step2.scenarios_hint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center justify-between gap-2 border-t border-border pt-5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                <ArrowLeft className="size-4" />
                {t('buttons.back')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('buttons.create')}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  )
}

function StepPill({
  n,
  label,
  active,
  done,
}: {
  n: number
  label: string
  active: boolean
  done: boolean
}) {
  return (
    <div
      className={
        'flex items-center gap-2 ' +
        (active ? 'text-foreground' : done ? 'text-primary' : 'text-muted-foreground')
      }
    >
      <span
        className={
          'flex size-6 items-center justify-center rounded-full border text-xs font-semibold ' +
          (active
            ? 'border-primary bg-primary/15 text-primary'
            : done
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border')
        }
      >
        {n}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </div>
  )
}
