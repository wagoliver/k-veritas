import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ExternalLink, Settings } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import { Link } from '@/lib/i18n/navigation'
import { getServerSession } from '@/lib/auth/session'
import { authorizeProject } from '@/lib/auth/project-access'
import { ProjectStatusBadge } from '@/components/projects/status-badge'
import { ProjectOverview } from '@/components/projects/project-overview'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>
}): Promise<Metadata> {
  const { projectId } = await params
  const session = await getServerSession()
  if (!session) return { title: 'k-veritas' }
  const project = await authorizeProject(session.user.id, projectId)
  return { title: project ? project.name : 'k-veritas' }
}

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>
}) {
  const { locale, projectId } = await params
  setRequestLocale(locale)
  const t = await getTranslations('projects.overview')

  const session = await getServerSession()
  if (!session) notFound()

  const project = await authorizeProject(session.user.id, projectId)
  if (!project) notFound()

  return (
    <main className="flex flex-1 flex-col p-6 lg:p-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
            <ProjectStatusBadge status={project.status} />
          </div>
          <a
            href={project.targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            {project.targetUrl}
            <ExternalLink className="size-3" />
          </a>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/projects/${project.id}/settings`}>
            <Settings className="size-4" />
            {t('settings')}
          </Link>
        </Button>
      </header>

      <ProjectOverview
        project={{
          id: project.id,
          name: project.name,
          status: project.status,
          description: project.description,
        }}
      />
    </main>
  )
}
