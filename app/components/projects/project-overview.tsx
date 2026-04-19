'use client'

import { Map, RotateCw, ScrollText, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useRouter } from '@/lib/i18n/navigation'
import { ProjectAnalysis } from './project-analysis'
import { ScenariosEditor } from './scenarios-editor'
import { SiteMapList } from './site-map-list'

interface ProjectOverviewProps {
  project: {
    id: string
    name: string
    status: string
    description: string | null
  }
}

type Tab = 'map' | 'scenarios' | 'analysis'

export function ProjectOverview({ project }: ProjectOverviewProps) {
  const t = useTranslations('projects.overview')
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('map')
  const [status, setStatus] = useState(project.status)
  const [recrawling, startRecrawl] = useTransition()

  // Poll leve (a cada 3s) enquanto houver crawl rodando
  useEffect(() => {
    if (status !== 'crawling') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          headers: { 'X-Requested-With': 'fetch' },
        })
        if (!res.ok) return
        const data = (await res.json()) as { status: string }
        if (data.status !== 'crawling') {
          setStatus(data.status)
          router.refresh()
        }
      } catch {
        // silencioso
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [status, project.id, router])

  const recrawl = () => {
    startRecrawl(async () => {
      const res = await fetch(`/api/projects/${project.id}/crawls`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'fetch' },
      })
      if (res.status === 409) {
        toast.error(t('errors.crawl_running'))
        return
      }
      if (res.status === 429) {
        toast.error(t('errors.rate_limited'))
        return
      }
      if (!res.ok) {
        toast.error(t('errors.generic'))
        return
      }
      toast.success(t('recrawl_started'))
      setStatus('crawling')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-border">
        <TabBtn
          active={tab === 'map'}
          onClick={() => setTab('map')}
          icon={<Map className="size-4" />}
          label={t('tabs.map')}
        />
        <TabBtn
          active={tab === 'scenarios'}
          onClick={() => setTab('scenarios')}
          icon={<ScrollText className="size-4" />}
          label={t('tabs.scenarios')}
        />
        <TabBtn
          active={tab === 'analysis'}
          onClick={() => setTab('analysis')}
          icon={<Sparkles className="size-4" />}
          label={t('tabs.analysis')}
        />
        <div className="ml-auto flex items-center gap-2 pb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={recrawl}
            disabled={recrawling || status === 'crawling'}
          >
            {recrawling ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCw className="size-4" />
            )}
            {status === 'crawling' ? t('crawling_progress') : t('recrawl')}
          </Button>
        </div>
      </div>

      {project.description ? (
        <p className="text-sm text-muted-foreground">{project.description}</p>
      ) : null}

      <section className={cn(tab === 'map' ? 'block' : 'hidden')}>
        <SiteMapList projectId={project.id} status={status} />
      </section>

      <section className={cn(tab === 'scenarios' ? 'block' : 'hidden')}>
        <ScenariosEditor projectId={project.id} />
      </section>

      <section className={cn(tab === 'analysis' ? 'block' : 'hidden')}>
        <ProjectAnalysis projectId={project.id} />
      </section>
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={cn(
        '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function _placeholder() {
  return <Skeleton className="h-20" />
}
