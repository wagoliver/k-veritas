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
import { PasswordInput } from '@/components/auth/password-input'
import { PasswordStrength } from '@/components/auth/password-strength'
import { passwordSchema } from '@/lib/auth/password-policy'

const schema = z
  .object({
    currentPassword: z.string().min(1, { message: 'errors.required' }),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'errors.mismatch',
  })

type Values = z.infer<typeof schema>

export function PasswordForm() {
  const t = useTranslations()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const password = form.watch('newPassword')

  const onSubmit = async (values: Values) => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      })
      if (res.status === 401) {
        toast.error(t('settings.security.password.errors.current_invalid'))
        return
      }
      if (!res.ok) {
        toast.error(t('auth.errors.generic'))
        return
      }
      toast.success(t('settings.security.password.success'))
      form.reset({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })
    } catch {
      toast.error(t('auth.errors.network'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-5"
        noValidate
      >
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t('settings.security.password.current')}
              </FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="current-password" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.fields.new_password')}</FormLabel>
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
              <FormLabel>{t('auth.fields.confirm_password')}</FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="new-password" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {t('settings.security.password.submit')}
        </Button>
      </form>
    </Form>
  )
}
