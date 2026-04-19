import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { AppShell } from '@/components/shell/app-shell'
import { getServerSession } from '@/lib/auth/session'
import {
  ensurePersonalOrg,
  getCurrentOrg,
  listUserOrgs,
} from '@/lib/auth/current-org'

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const session = await getServerSession()
  if (!session) {
    redirect(`/${locale}/login`)
  }
  if (session.mfaLevel === 'none') {
    redirect(`/${locale}/mfa/verify`)
  }

  // Backfill: usuários da Fase 1 podem não ter org Personal
  let org = await getCurrentOrg(session.user.id)
  if (!org) {
    await ensurePersonalOrg(session.user.id)
    org = await getCurrentOrg(session.user.id)
    if (!org) throw new Error('failed to provision default org')
  }

  const allOrgs = await listUserOrgs(session.user.id)
  const hasMultipleOrgs = allOrgs.length > 1

  const cookieStore = await cookies()
  const sidebarCookie = cookieStore.get('sidebar_state')?.value
  const sidebarDefaultOpen = sidebarCookie ? sidebarCookie !== 'false' : true

  return (
    <AppShell
      user={{
        id: session.user.id,
        displayName: session.user.displayName,
        email: session.user.email,
      }}
      org={org}
      hasMultipleOrgs={hasMultipleOrgs}
      sidebarDefaultOpen={sidebarDefaultOpen}
    >
      {children}
    </AppShell>
  )
}
