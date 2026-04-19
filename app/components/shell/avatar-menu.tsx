'use client'

import { LogOut, ShieldCheck, User as UserIcon } from 'lucide-react'
import { useTransition } from 'react'
import { useTranslations } from 'next-intl'

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Link, useRouter } from '@/lib/i18n/navigation'
import { ThemeRadioGroup } from './theme-toggle'

interface AvatarMenuProps {
  user: {
    id: string
    displayName: string | null
    email: string
  }
}

function initials(name: string | null, fallback: string): string {
  const source = (name ?? fallback).trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

export function AvatarMenu({ user }: AvatarMenuProps) {
  const t = useTranslations('shell')
  const router = useRouter()
  const [pending, start] = useTransition()

  const logout = () => {
    start(async () => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Requested-With': 'fetch' },
      })
      router.replace('/login')
      router.refresh()
    })
  }

  const label = user.displayName ?? user.email
  const sub = user.displayName ? user.email : ''

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative flex h-9 items-center gap-2 rounded-full px-1.5 pr-3"
          aria-label={t('avatar.open')}
        >
          <Avatar className="size-7">
            <AvatarImage alt={label} />
            <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
              {initials(user.displayName, user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline max-w-[140px] truncate text-sm">
            {label}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{label}</span>
          {sub ? (
            <span className="truncate text-xs text-muted-foreground">
              {sub}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserIcon className="size-4" />
            <span>{t('avatar.profile')}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/security">
            <ShieldCheck className="size-4" />
            <span>{t('avatar.security')}</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <ThemeRadioGroup />
        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onSelect={logout}
          disabled={pending}
        >
          <LogOut className="size-4" />
          <span>{t('avatar.logout')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
