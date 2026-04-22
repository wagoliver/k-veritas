import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { getServerSession } from '@/lib/auth/session'
import { authorizeProject } from '@/lib/auth/project-access'
import { ProjectFlowNav } from '@/components/projects/project-flow-nav'
import { SiteMapTabs } from '@/components/projects/site-map-tabs'

export default async function ProjectMapPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>
}) {
  const { locale, projectId } = await params
  setRequestLocale(locale)

  const session = await getServerSession()
  if (!session) notFound()
  const project = await authorizeProject(session.user.id, projectId)
  if (!project) notFound()

  return (
    <>
      <SiteMapTabs
        projectId={project.id}
        status={project.status}
        sourceType={project.sourceType as 'url' | 'repo'}
      />
      <ProjectFlowNav projectId={project.id} current="map" />
    </>
  )
}
