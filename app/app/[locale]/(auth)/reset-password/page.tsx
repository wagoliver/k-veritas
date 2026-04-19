import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { AuthCard } from '@/components/auth/auth-card'
import { ResetForm } from '@/components/auth/reset-form'
import { Link } from '@/lib/i18n/navigation'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.reset' })
  return { title: t('meta_title') }
}

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ token?: string }>
}) {
  const { locale } = await params
  const { token } = await searchParams
  setRequestLocale(locale)
  const t = await getTranslations('auth')

  return (
    <AuthCard
      title={t('reset.title')}
      description={t('reset.description')}
      footer={
        <Link
          href="/login"
          className="text-primary hover:underline underline-offset-4"
        >
          {t('reset.back_to_login')}
        </Link>
      }
    >
      {token ? (
        <ResetForm token={token} />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>{t('reset.errors.missing_token')}</AlertDescription>
        </Alert>
      )}
    </AuthCard>
  )
}
