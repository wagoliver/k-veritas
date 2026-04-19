'use client'

import {
  FolderGit2,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  User as UserIcon,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { useRouter } from '@/lib/i18n/navigation'
import { useCommandPalette } from './command-palette-context'

export function CommandPalette() {
  const t = useTranslations('shell.command')
  const { isOpen, close } = useCommandPalette()
  const router = useRouter()
  const { setTheme } = useTheme()

  const go = (href: string) => {
    close()
    router.push(href)
  }

  const logout = async () => {
    close()
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch' },
    })
    router.replace('/login')
    router.refresh()
  }

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(v) => (v ? null : close())}
      title={t('title')}
      description={t('description')}
    >
      <CommandInput placeholder={t('placeholder')} />
      <CommandList>
        <CommandEmpty>{t('empty')}</CommandEmpty>

        <CommandGroup heading={t('groups.navigate')}>
          <CommandItem value="projects" onSelect={() => go('/projects')}>
            <FolderGit2 />
            <span>{t('actions.projects')}</span>
          </CommandItem>
          <CommandItem value="profile" onSelect={() => go('/settings/profile')}>
            <UserIcon />
            <span>{t('actions.profile')}</span>
          </CommandItem>
          <CommandItem value="security" onSelect={() => go('/settings/security')}>
            <ShieldCheck />
            <span>{t('actions.security')}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t('groups.appearance')}>
          <CommandItem
            value="theme-light"
            onSelect={() => {
              setTheme('light')
              close()
            }}
          >
            <Sun />
            <span>{t('actions.theme_light')}</span>
          </CommandItem>
          <CommandItem
            value="theme-dark"
            onSelect={() => {
              setTheme('dark')
              close()
            }}
          >
            <Moon />
            <span>{t('actions.theme_dark')}</span>
          </CommandItem>
          <CommandItem
            value="theme-system"
            onSelect={() => {
              setTheme('system')
              close()
            }}
          >
            <Monitor />
            <span>{t('actions.theme_system')}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t('groups.account')}>
          <CommandItem value="logout" onSelect={logout}>
            <LogOut />
            <span>{t('actions.logout')}</span>
            <CommandShortcut>⇧⌘Q</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
