import { redirect } from '@/lib/i18n/navigation'
import { getServerSession } from '@/lib/auth/session'

export default async function LocaleRoot({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await getServerSession()
  redirect({ href: session ? '/dashboard' : '/login', locale })
}
