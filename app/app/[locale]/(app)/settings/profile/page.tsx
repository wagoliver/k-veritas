import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ProfileForm } from '@/components/settings/profile-form'
import { getServerSession } from '@/lib/auth/session'
import { isLocale, DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'settings.profile' })
  return { title: t('meta_title') }
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('settings.profile')

  const session = await getServerSession()
  if (!session) redirect(`/${locale}/login`)

  const userLocale: Locale = isLocale(session.user.locale)
    ? session.user.locale
    : DEFAULT_LOCALE

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <ProfileForm
        email={session.user.email}
        defaultValues={{
          displayName: session.user.displayName ?? '',
          locale: userLocale,
        }}
      />
    </div>
  )
}
