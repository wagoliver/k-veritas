'use client'

import { Loader2, Sparkles } from 'lucide-react'
import { useTransition, type MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

/**
 * Dispara um re-crawler limitado a UMA página. Reaproveita a fila de
 * crawl_jobs com scope='single_path'. Atualiza o último crawl completed
 * do projeto em-place (upsert por URL).
 *
 * `url` deve ser a URL absoluta da página (mesmo formato salvo em
 * crawl_pages.url). O backend resolve contra project.target_url pra
 * rejeitar cross-origin.
 */
export function RecrawlPathButton({
  projectId,
  url,
  onUpdated,
  size = 'sm',
}: {
  projectId: string
  url: string
  onUpdated?: () => void
  size?: 'sm' | 'md'
}) {
  const t = useTranslations('projects.overview.map.recrawl_path')
  const [pending, start] = useTransition()

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation()
    start(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/crawls`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({ scope: 'single_path', url }),
        })
        if (res.status === 429) {
          toast.error(t('errors.rate_limited'))
          return
        }
        if (!res.ok) {
          toast.error(t('errors.generic'))
          return
        }
        toast.success(t('enqueued'))
        // Pequena espera antes de recarregar: o worker pega o job em ~2s
        setTimeout(() => onUpdated?.(), 3000)
      } catch {
        toast.error(t('errors.network'))
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={t('label')}
      aria-label={t('label')}
      className={cn(
        'inline-flex items-center justify-center rounded text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground',
        'disabled:opacity-60',
        size === 'sm' ? 'size-6' : 'size-7',
      )}
    >
      {pending ? (
        <Loader2 className={cn('animate-spin', size === 'sm' ? 'size-3.5' : 'size-4')} />
      ) : (
        <Sparkles className={size === 'sm' ? 'size-3.5' : 'size-4'} />
      )}
    </button>
  )
}
