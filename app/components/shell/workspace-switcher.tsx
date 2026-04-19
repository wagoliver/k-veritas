'use client'

import { ChevronsUpDown } from 'lucide-react'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import type { CurrentOrg } from '@/lib/auth/current-org'

interface WorkspaceSwitcherProps {
  org: CurrentOrg
  hasMultipleOrgs: boolean
}

export function WorkspaceSwitcher({
  org,
  hasMultipleOrgs,
}: WorkspaceSwitcherProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          aria-disabled={!hasMultipleOrgs}
          tooltip={org.name}
        >
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-md font-display text-sm font-semibold">
            {org.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{org.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {org.slug}
            </span>
          </div>
          {hasMultipleOrgs ? (
            <ChevronsUpDown className="ml-auto size-4" />
          ) : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
