import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthCard } from '@/components/auth/auth-card'
import { MfaVerifyForm } from '@/components/auth/mfa-verify-form'
import { Link } from '@/lib/i18n/navigation'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.mfa_verify' })
  return { title: t('meta_title') }
}

export default async function MfaVerifyPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')

  return (
    <AuthCard
      title={t('mfa_verify.title')}
      description={t('mfa_verify.description')}
      footer={
        <Link
          href="/login"
          className="text-primary hover:underline underline-offset-4"
        >
          {t('mfa_verify.back_to_login')}
        </Link>
      }
    >
      <MfaVerifyForm />
    </AuthCard>
  )
}
