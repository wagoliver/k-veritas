'use client'

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import type { CurrentOrg } from '@/lib/auth/current-org'
import { CommandPalette } from './command-palette'
import { CommandPaletteProvider } from './command-palette-context'
import { Footer } from './footer'
import { SidebarNav } from './sidebar-nav'
import { Topbar } from './topbar'

interface AppShellProps {
  children: React.ReactNode
  user: {
    id: string
    displayName: string | null
    email: string
  }
  org: CurrentOrg
  hasMultipleOrgs: boolean
  sidebarDefaultOpen: boolean
}

export function AppShell({
  children,
  user,
  org,
  hasMultipleOrgs,
  sidebarDefaultOpen,
}: AppShellProps) {
  return (
    <CommandPaletteProvider>
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        <SidebarNav org={org} hasMultipleOrgs={hasMultipleOrgs} />
        <SidebarInset className="flex min-h-svh flex-col">
          <Topbar user={user} />
          <div className="flex flex-1 flex-col">{children}</div>
          <Footer />
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette />
    </CommandPaletteProvider>
  )
}
