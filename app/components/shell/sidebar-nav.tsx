'use client'

import {
  Activity,
  ChevronRight,
  FileCode2,
  FolderGit2,
  LifeBuoy,
  Map,
  Play,
  ScrollText,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { Link, usePathname } from '@/lib/i18n/navigation'
import type { CurrentOrg } from '@/lib/auth/current-org'
import { WorkspaceSwitcher } from './workspace-switcher'

interface SidebarNavProps {
  org: CurrentOrg
  hasMultipleOrgs: boolean
}

/**
 * Detecta se a rota atual está dentro de um projeto e extrai o id.
 * Retorna null fora de /projects/[id]/*.
 */
function projectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)(\/|$)/)
  if (!match) return null
  const id = match[1]
  if (id === 'new') return null
  return id
}

interface SidebarProject {
  id: string
  name: string
  status: string
}

export function SidebarNav({ org, hasMultipleOrgs }: SidebarNavProps) {
  const t = useTranslations('shell')
  const pathname = usePathname()
  const currentProjectId = projectIdFromPath(pathname)

  const [projects, setProjects] = useState<SidebarProject[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(currentProjectId ? [currentProjectId] : []),
  )

  // Carrega lista de projetos do usuário pra popular o accordion.
  // Recarrega quando o pathname muda pra pegar projeto recém-criado.
  useEffect(() => {
    let cancelled = false
    fetch('/api/projects', {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setProjects(data.items ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pathname])

  // Ao navegar pra um projeto, expandir ele automaticamente (sem colapsar
  // os outros que o usuário já tenha aberto).
  useEffect(() => {
    if (!currentProjectId) return
    setExpandedIds((prev) => {
      if (prev.has(currentProjectId)) return prev
      const next = new Set(prev)
      next.add(currentProjectId)
      return next
    })
  }, [currentProjectId])

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)
  const isExactActive = (href: string) => pathname === href

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

  const sideDisabled = [
    {
      label: t('nav.activity'),
      href: '/activity',
      icon: Activity,
      hint: t('nav.soon'),
    },
    {
      label: t('nav.team'),
      href: '/team',
      icon: Users,
      hint: t('nav.soon'),
    },
  ]

  const projectsActive = isActive('/projects')

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
              {/* Projetos — link pra lista + accordion com cada projeto */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === '/projects' || pathname === '/projects/new'}
                  tooltip={t('nav.projects')}
                >
                  <Link
                    href="/projects"
                    aria-current={projectsActive ? 'page' : undefined}
                  >
                    <FolderGit2 />
                    <span>{t('nav.projects')}</span>
                  </Link>
                </SidebarMenuButton>
                {projects.length > 0 ? (
                  <SidebarMenuSub>
                    {projects.map((p) => (
                      <ProjectAccordionItem
                        key={p.id}
                        project={p}
                        expanded={expandedIds.has(p.id)}
                        onToggle={() => toggleExpanded(p.id)}
                        isCurrent={currentProjectId === p.id}
                        isExactActive={isExactActive}
                        t={t}
                      />
                    ))}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>

              {sideDisabled.map((item) => {
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      disabled
                      tooltip={item.hint}
                    >
                      <span className="flex items-center gap-2 opacity-50">
                        <Icon />
                        <span>{item.label}</span>
                      </span>
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

const PROJECT_SECTIONS: Array<{
  key: 'map' | 'analysis' | 'test_scenarios' | 'execution'
  slug: string
  icon: typeof Map
}> = [
  { key: 'map', slug: 'map', icon: Map },
  // "analysis" é a página que lista cenários gerados pela IA —
  // substitui a antiga "scenarios" (manual, nunca preenchida).
  // O slug de URL continua 'analysis' por retrocompatibilidade.
  { key: 'analysis', slug: 'analysis', icon: ScrollText },
  { key: 'test_scenarios', slug: 'test-scenarios', icon: FileCode2 },
  { key: 'execution', slug: 'execution', icon: Play },
]

function ProjectAccordionItem({
  project,
  expanded,
  onToggle,
  isCurrent,
  isExactActive,
  t,
}: {
  project: SidebarProject
  expanded: boolean
  onToggle: () => void
  isCurrent: boolean
  isExactActive: (href: string) => boolean
  t: ReturnType<typeof useTranslations<'shell'>>
}) {
  return (
    <SidebarMenuSubItem>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-7 w-full min-w-0 -translate-x-px items-center gap-1.5 overflow-hidden rounded-md px-2 text-sm outline-hidden transition-colors',
          isCurrent && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
        )}
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left">{project.name}</span>
      </button>
      {expanded ? (
        <ul className="border-sidebar-border ml-[14px] mt-0.5 flex flex-col gap-0.5 border-l pl-2">
          {PROJECT_SECTIONS.map((section) => {
            const Icon = section.icon
            const href = `/projects/${project.id}/${section.slug}`
            const active = isExactActive(href)
            return (
              <li key={section.slug}>
                <SidebarMenuSubButton asChild isActive={active} size="sm">
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon />
                    <span>{t(`nav.project.${section.key}`)}</span>
                  </Link>
                </SidebarMenuSubButton>
              </li>
            )
          })}
        </ul>
      ) : null}
    </SidebarMenuSubItem>
  )
}
