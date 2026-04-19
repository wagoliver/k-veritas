import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthCard } from '@/components/auth/auth-card'
import { MfaEnrollForm } from '@/components/auth/mfa-enroll-form'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.mfa_enroll' })
  return { title: t('meta_title') }
}

export default async function MfaEnrollPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="relative z-10 w-full max-w-md animate-fade-up">
        <AuthCard
          title={t('mfa_enroll.title')}
          description={t('mfa_enroll.description')}
        >
          <MfaEnrollForm />
        </AuthCard>
      </div>
    </main>
  )
}
