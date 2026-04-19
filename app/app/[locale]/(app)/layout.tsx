import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { getServerSession } from '@/lib/auth/session'

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

  return <>{children}</>
}
