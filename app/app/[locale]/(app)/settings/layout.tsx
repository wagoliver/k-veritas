import { setRequestLocale } from 'next-intl/server'

import { SettingsNav } from '@/components/settings/settings-nav'

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="flex flex-1 flex-col gap-8 p-6 lg:p-10">
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <SettingsNav />
        </aside>
        <section className="min-w-0">{children}</section>
      </div>
    </main>
  )
}
