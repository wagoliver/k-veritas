'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
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
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'errors.mismatch',
  })

type Values = z.infer<typeof schema>

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations('auth')
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  })

  const password = form.watch('newPassword')

  const onSubmit = async (values: Values) => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({ token, newPassword: values.newPassword }),
      })
      if (res.status === 401) {
        toast.error(t('reset.errors.invalid_token'))
        return
      }
      if (!res.ok) {
        toast.error(t('errors.generic'))
        return
      }
      toast.success(t('reset.success'))
      router.replace('/login')
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
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.new_password')}</FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="new-password" autoFocus />
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

        <Button type="submit" className="w-full" size="lg" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {t('reset.submit')}
        </Button>
      </form>
    </Form>
  )
}
