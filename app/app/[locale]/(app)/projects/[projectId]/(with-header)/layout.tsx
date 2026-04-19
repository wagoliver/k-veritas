import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { getServerSession } from '@/lib/auth/session'
import { authorizeProject } from '@/lib/auth/project-access'
import { ProjectHeader } from '@/components/projects/project-header'

export default async function ProjectWithHeaderLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string; projectId: string }>
}) {
  const { locale, projectId } = await params
  setRequestLocale(locale)

  const session = await getServerSession()
  if (!session) notFound()

  const project = await authorizeProject(session.user.id, projectId)
  if (!project) notFound()

  return (
    <main className="flex flex-1 flex-col p-6 lg:p-10">
      <ProjectHeader
        project={{
          id: project.id,
          name: project.name,
          status: project.status,
          targetUrl: project.targetUrl,
          description: project.description,
        }}
      />
      {children}
    </main>
  )
}
