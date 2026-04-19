import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getServerSession } from '@/lib/auth/session'
import { authorizeProject } from '@/lib/auth/project-access'

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

// A raíz do projeto não tem conteúdo próprio — redireciona pra primeira
// seção (Mapa do site). A navegação real vive na sidebar contextual.
export default async function ProjectRootPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>
}) {
  const { locale, projectId } = await params
  // Pre-warm para metadata
  await getTranslations({ locale, namespace: 'projects.overview' })
  redirect(`/${locale}/projects/${projectId}/map`)
}
