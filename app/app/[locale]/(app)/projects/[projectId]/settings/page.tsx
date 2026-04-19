import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
import { getServerSession } from '@/lib/auth/session'
import { authorizeProject } from '@/lib/auth/project-access'
import { ProjectSettingsForm } from '@/components/projects/project-settings-form'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'projects.settings' })
  return { title: t('meta_title') }
}

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>
}) {
  const { locale, projectId } = await params
  setRequestLocale(locale)
  const t = await getTranslations('projects.settings')

  const session = await getServerSession()
  if (!session) notFound()
  const project = await authorizeProject(session.user.id, projectId)
  if (!project) notFound()

  return (
    <main className="flex flex-1 flex-col p-6 lg:p-10">
      <div className="mx-auto w-full max-w-2xl space-y-8">
        <header>
          <Link
            href={`/projects/${project.id}`}
            className="text-sm text-muted-foreground hover:underline underline-offset-4"
          >
            ← {t('back')}
          </Link>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('subtitle', { name: project.name })}
          </p>
        </header>

        <ProjectSettingsForm
          project={{
            id: project.id,
            name: project.name,
            targetUrl: project.targetUrl,
            description: project.description,
            authKind: project.authKind as 'none' | 'form',
            crawlMaxDepth: project.crawlMaxDepth,
            targetLocale: project.targetLocale,
          }}
        />
      </div>
    </main>
  )
}
