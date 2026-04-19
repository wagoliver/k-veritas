import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Separator } from '@/components/ui/separator'
import { MfaCard } from '@/components/settings/mfa-card'
import { PasswordForm } from '@/components/settings/password-form'
import { SessionsList } from '@/components/settings/sessions-list'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'settings.security' })
  return { title: t('meta_title') }
}

export default async function SecurityPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('settings.security')

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="font-display text-lg font-semibold">
            {t('mfa.section_title')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('mfa.section_subtitle')}
          </p>
        </div>
        <MfaCard />
      </section>

      <Separator />

      <section className="space-y-4">
        <div>
          <h2 className="font-display text-lg font-semibold">
            {t('password.section_title')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('password.section_subtitle')}
          </p>
        </div>
        <PasswordForm />
      </section>

      <Separator />

      <section className="space-y-4">
        <div>
          <h2 className="font-display text-lg font-semibold">
            {t('sessions.section_title')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('sessions.section_subtitle')}
          </p>
        </div>
        <SessionsList />
      </section>
    </div>
  )
}
