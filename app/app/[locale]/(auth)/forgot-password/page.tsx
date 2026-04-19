import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthCard } from '@/components/auth/auth-card'
import { ForgotForm } from '@/components/auth/forgot-form'
import { Link } from '@/lib/i18n/navigation'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.forgot' })
  return { title: t('meta_title') }
}

export default async function ForgotPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')

  return (
    <AuthCard
      title={t('forgot.title')}
      description={t('forgot.description')}
      footer={
        <Link
          href="/login"
          className="text-primary hover:underline underline-offset-4"
        >
          {t('forgot.back_to_login')}
        </Link>
      }
    >
      <ForgotForm />
    </AuthCard>
  )
}
