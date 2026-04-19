'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Spinner } from '@/components/ui/spinner'
import { useRouter } from '@/lib/i18n/navigation'
import { passwordSchema } from '@/lib/auth/password-policy'
import { PasswordInput } from './password-input'
import { PasswordStrength } from './password-strength'

const schema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, { message: 'errors.min_2' })
      .max(80, { message: 'errors.max_80' }),
    email: z.string().email({ message: 'errors.email' }),
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z
      .boolean()
      .refine((v) => v === true, { message: 'errors.terms' }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'errors.mismatch',
  })

type Values = z.infer<typeof schema>

export function RegisterForm() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
    },
  })

  const password = form.watch('password')

  const onSubmit = async (values: Values) => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          displayName: values.displayName,
          locale,
        }),
      })

      if (res.status === 409) {
        toast.error(t('register.errors.conflict'))
        return
      }
      if (res.status === 429) {
        toast.error(t('register.errors.rate_limited'))
        return
      }
      if (!res.ok) {
        toast.error(t('errors.generic'))
        return
      }

      toast.success(t('register.success'))
      router.push('/login')
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
      >
        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.display_name')}</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="name" autoFocus />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.email')}</FormLabel>
              <FormControl>
                <Input {...field} type="email" autoComplete="email" />
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
              <FormLabel>{t('fields.password')}</FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="new-password" />
              </FormControl>
              <PasswordStrength value={password} />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.confirm_password')}</FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="new-password" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="acceptTerms"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-start gap-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label={t('register.accept_terms')}
                  />
                </FormControl>
                <FormLabel className="!text-sm font-normal leading-snug text-muted-foreground">
                  {t('register.accept_terms')}
                </FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submitting}
        >
          {submitting ? <Spinner /> : null}
          {t('register.submit')}
        </Button>
      </form>
    </Form>
  )
}
