'use client'

import { useTransition } from 'react'
import { LogOut } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { useRouter } from '@/lib/i18n/navigation'

export function LogoutButton() {
  const t = useTranslations('auth.logout')
  const router = useRouter()
  const [pending, start] = useTransition()

  const handle = () => {
    start(async () => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Requested-With': 'fetch' },
      })
      router.replace('/login')
      router.refresh()
    })
  }

  return (
    <Button variant="ghost" size="sm" onClick={handle} disabled={pending}>
      <LogOut className="size-4" />
      {t('label')}
    </Button>
  )
}
