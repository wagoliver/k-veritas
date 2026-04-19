import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LogoutButton } from '@/components/auth/logout-button'
import { getServerSession } from '@/lib/auth/session'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('dashboard')
  const session = await getServerSession()

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t('welcome', { name: session?.user.displayName ?? '' })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section className="surface-card rounded-xl p-6">
        <h2 className="font-display text-lg font-semibold">
          {t('placeholder_title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('placeholder_body')}
        </p>
      </section>
    </main>
  )
}
