'use client'

import {
  Activity,
  FolderGit2,
  LifeBuoy,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Link, usePathname } from '@/lib/i18n/navigation'
import type { CurrentOrg } from '@/lib/auth/current-org'
import { WorkspaceSwitcher } from './workspace-switcher'

interface SidebarNavProps {
  org: CurrentOrg
  hasMultipleOrgs: boolean
}

export function SidebarNav({ org, hasMultipleOrgs }: SidebarNavProps) {
  const t = useTranslations('shell')
  const pathname = usePathname()

  const primary = [
    {
      label: t('nav.projects'),
      href: '/projects',
      icon: FolderGit2,
      enabled: true,
    },
    {
      label: t('nav.activity'),
      href: '/activity',
      icon: Activity,
      enabled: false,
      hint: t('nav.soon'),
    },
    {
      label: t('nav.team'),
      href: '/team',
      icon: Users,
      enabled: false,
      hint: t('nav.soon'),
    },
  ]

  const secondary = [
    {
      label: t('nav.settings'),
      href: '/settings',
      icon: SettingsIcon,
      enabled: true,
    },
    {
      label: t('nav.help'),
      href: '/help',
      icon: LifeBuoy,
      enabled: false,
      hint: t('nav.soon'),
    },
  ]

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <WorkspaceSwitcher org={org} hasMultipleOrgs={hasMultipleOrgs} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.overview')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primary.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild={item.enabled}
                      disabled={!item.enabled}
                      isActive={active}
                      tooltip={item.hint ?? item.label}
                    >
                      {item.enabled ? (
                        <Link href={item.href} aria-current={active ? 'page' : undefined}>
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      ) : (
                        <span className="flex items-center gap-2 opacity-50">
                          <Icon />
                          <span>{item.label}</span>
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {secondary.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild={item.enabled}
                  disabled={!item.enabled}
                  isActive={active}
                  tooltip={item.hint ?? item.label}
                  size="sm"
                >
                  {item.enabled ? (
                    <Link href={item.href} aria-current={active ? 'page' : undefined}>
                      <Icon />
                      <span>{item.label}</span>
                    </Link>
                  ) : (
                    <span className="flex items-center gap-2 opacity-50">
                      <Icon />
                      <span>{item.label}</span>
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
