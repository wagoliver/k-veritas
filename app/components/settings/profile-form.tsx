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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useRouter } from '@/lib/i18n/navigation'
import { LOCALES } from '@/lib/i18n/config'

const schema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, { message: 'errors.min_2' })
    .max(80, { message: 'errors.max_80' }),
  locale: z.enum(LOCALES),
})

type Values = z.infer<typeof schema>

interface ProfileFormProps {
  defaultValues: Values
  email: string
}

export function ProfileForm({ defaultValues, email }: ProfileFormProps) {
  const t = useTranslations()
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const onSubmit = async (values: Values) => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        toast.error(t('auth.errors.generic'))
        return
      }
      toast.success(t('settings.profile.saved'))
      form.reset(values)
      if (values.locale !== defaultValues.locale) {
        router.replace('/settings/profile', { locale: values.locale })
      } else {
        router.refresh()
      }
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
        <FormItem>
          <FormLabel>{t('auth.fields.email')}</FormLabel>
          <Input value={email} disabled />
          <FormDescription>{t('settings.profile.email_hint')}</FormDescription>
        </FormItem>

        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.fields.display_name')}</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="locale"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('settings.profile.locale_label')}</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none dark:bg-input/30"
                >
                  {LOCALES.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc === 'pt-BR' ? 'Português (Brasil)' : 'English (US)'}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormDescription>
                {t('settings.profile.locale_hint')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center gap-3 border-t border-border pt-5">
          <Button
            type="submit"
            disabled={submitting || !form.formState.isDirty}
          >
            {submitting ? <Spinner /> : null}
            {t('settings.profile.save')}
          </Button>
          {form.formState.isDirty ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => form.reset(defaultValues)}
              disabled={submitting}
            >
              {t('settings.profile.discard')}
            </Button>
          ) : null}
        </div>
      </form>
    </Form>
  )
}
