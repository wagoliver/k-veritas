import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

type Status = 'draft' | 'crawling' | 'ready' | 'failed' | string

const TONE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  crawling: 'bg-primary/15 text-primary',
  ready: 'bg-fin-gain/15 text-fin-gain',
  failed: 'bg-destructive/15 text-destructive',
}

export function ProjectStatusBadge({ status }: { status: Status }) {
  const t = useTranslations('projects.status')
  const labelKey = ['draft', 'crawling', 'ready', 'failed'].includes(status)
    ? (status as 'draft')
    : 'draft'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        TONE[status] ?? TONE.draft,
      )}
    >
      {status === 'crawling' ? (
        <span className="mr-1.5 size-1.5 animate-pulse rounded-full bg-primary" />
      ) : null}
      {t(labelKey)}
    </span>
  )
}
