'use client'

import { ExternalLink, Loader2, RotateCw, Settings } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Link, useRouter } from '@/lib/i18n/navigation'
import { ProjectStatusBadge } from './status-badge'

interface ProjectHeaderProps {
  project: {
    id: string
    name: string
    status: string
    targetUrl: string
    description: string | null
  }
}

export function ProjectHeader({ project }: ProjectHeaderProps) {
  const t = useTranslations('projects.overview')
  const router = useRouter()
  const [status, setStatus] = useState(project.status)
  const [recrawling, startRecrawl] = useTransition()

  // Poll leve enquanto houver crawl rodando
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
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <ProjectStatusBadge status={status} />
        </div>
        <a
          href={project.targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          {project.targetUrl}
          <ExternalLink className="size-3" />
        </a>
        {project.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{project.description}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
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
        <Button asChild variant="outline" size="sm">
          <Link href={`/projects/${project.id}/settings`}>
            <Settings className="size-4" />
            {t('settings')}
          </Link>
        </Button>
      </div>
    </header>
  )
}
