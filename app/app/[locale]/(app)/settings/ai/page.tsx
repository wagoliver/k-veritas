import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getServerSession } from '@/lib/auth/session'
import { getCurrentOrg } from '@/lib/auth/current-org'
import { getOrgAiConfigView } from '@/lib/ai/config'
import { AiConfigForm } from '@/components/settings/ai-config-form'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'settings.ai' })
  return { title: t('meta_title') }
}

export default async function AISettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('settings.ai')

  const session = await getServerSession()
  if (!session) redirect(`/${locale}/login`)

  const org = await getCurrentOrg(session.user.id)
  if (!org) redirect(`/${locale}/login`)

  const config = await getOrgAiConfigView(org.id)
  const canEdit = org.role === 'owner' || org.role === 'admin'

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <AiConfigForm initial={config} canEdit={canEdit} />
    </div>
  )
}
