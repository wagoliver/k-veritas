'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/lib/i18n/navigation'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
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
import { PasswordInput } from './password-input'

const schema = z.object({
  email: z.string().email({ message: 'errors.email' }),
  password: z.string().min(1, { message: 'errors.required' }),
})

type Values = z.infer<typeof schema>

export function LoginForm() {
  const t = useTranslations('auth')
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/dashboard'
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: Values) => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify(values),
      })

      if (res.status === 401) {
        toast.error(t('login.errors.invalid_credentials'))
        return
      }
      if (res.status === 429) {
        toast.error(t('login.errors.rate_limited'))
        return
      }
      if (!res.ok) {
        toast.error(t('errors.generic'))
        return
      }

      const body = (await res.json()) as {
        mfaRequired?: boolean
      }

      if (body.mfaRequired) {
        router.push('/mfa/verify')
      } else {
        router.push(next.startsWith('/') ? next : '/dashboard')
        router.refresh()
      }
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
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.email')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoFocus
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
              <FormLabel>{t('fields.password')}</FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="current-password" />
              </FormControl>
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
          {t('login.submit')}
        </Button>
      </form>
    </Form>
  )
}
