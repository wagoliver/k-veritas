import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { CreateProjectWizard } from '@/components/projects/create-project-wizard'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({
    locale,
    namespace: 'projects.wizard',
  })
  return { title: t('meta_title') }
}

export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="flex flex-1 flex-col p-6 lg:p-10">
      <div className="mx-auto w-full max-w-2xl">
        <CreateProjectWizard />
      </div>
    </main>
  )
}
