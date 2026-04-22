import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { getServerSession } from '@/lib/auth/session'
import { authorizeProject } from '@/lib/auth/project-access'
import { ProjectTestScripts } from '@/components/projects/project-test-scripts'

export default async function ProjectTestScenariosPage({
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

  return <ProjectTestScripts projectId={project.id} />
}
