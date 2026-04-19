import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthCard } from '@/components/auth/auth-card'
import { RegisterForm } from '@/components/auth/register-form'
import { Link } from '@/lib/i18n/navigation'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.register' })
  return { title: t('meta_title') }
}

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')

  return (
    <AuthCard
      title={t('register.title')}
      description={t('register.description')}
      footer={
        <span>
          {t('register.have_account')}{' '}
          <Link
            href="/login"
            className="text-primary hover:underline underline-offset-4"
          >
            {t('register.login')}
          </Link>
        </span>
      }
    >
      <RegisterForm />
    </AuthCard>
  )
}
