import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { getServerSession } from '@/lib/auth/session'
import { authorizeProject } from '@/lib/auth/project-access'
import { ProjectExecution } from '@/components/projects/project-execution'
import { ProjectFlowNav } from '@/components/projects/project-flow-nav'

export default async function ProjectExecutionPage({
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
      <ProjectExecution projectId={project.id} />
      <ProjectFlowNav projectId={project.id} current="execution" />
    </>
  )
}
