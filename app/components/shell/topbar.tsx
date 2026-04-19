'use client'

import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Breadcrumbs } from './breadcrumbs'
import { AvatarMenu } from './avatar-menu'
import { useCommandPalette } from './command-palette-context'

interface TopbarProps {
  user: {
    id: string
    displayName: string | null
    email: string
  }
}

export function Topbar({ user }: TopbarProps) {
  const t = useTranslations('shell')
  const { open } = useCommandPalette()

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-5" />

      <div className="hidden min-w-0 flex-1 md:block">
        <Breadcrumbs />
      </div>

      <div className="flex flex-1 items-center justify-end gap-2 md:flex-initial">
        <Button
          variant="outline"
          size="sm"
          className="h-8 justify-between gap-3 text-muted-foreground md:w-64"
          onClick={open}
          aria-label={t('search.open')}
        >
          <span className="flex items-center gap-2">
            <Search className="size-3.5" />
            <span className="hidden sm:inline">{t('search.placeholder')}</span>
          </span>
          <kbd className="hidden items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
            <span>⌘</span>K
          </kbd>
        </Button>

        <AvatarMenu user={user} />
      </div>
    </header>
  )
}
