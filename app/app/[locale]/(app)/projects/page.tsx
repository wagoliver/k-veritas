import type { Metadata } from 'next'
import { FolderPlus } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Button } from '@/components/ui/button'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'projects' })
  return { title: t('title') }
}

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('projects')

  return (
    <main className="flex flex-1 flex-col p-6 lg:p-10">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <section className="flex flex-1 items-center justify-center">
        <div className="surface-card glow-teal-sm flex max-w-md flex-col items-center gap-4 rounded-xl px-8 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FolderPlus className="size-6" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">
              {t('empty.title')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('empty.description')}
            </p>
          </div>
          <Button disabled className="mt-2">
            {t('empty.cta')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('empty.hint')}</p>
        </div>
      </section>
    </main>
  )
}
