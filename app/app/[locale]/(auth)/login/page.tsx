import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthCard } from '@/components/auth/auth-card'
import { LoginForm } from '@/components/auth/login-form'
import { Link } from '@/lib/i18n/navigation'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.login' })
  return { title: t('meta_title') }
}

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')

  return (
    <AuthCard
      title={t('login.title')}
      description={t('login.description')}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Link
            href="/forgot-password"
            className="text-primary hover:underline underline-offset-4"
          >
            {t('login.forgot_password')}
          </Link>
          <span>
            {t('login.no_account')}{' '}
            <Link
              href="/register"
              className="text-primary hover:underline underline-offset-4"
            >
              {t('login.register')}
            </Link>
          </span>
        </div>
      }
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthCard>
  )
}
