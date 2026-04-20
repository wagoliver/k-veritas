'use client'

import { Code2, Globe } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import { CodeAnalysisPanel } from './code-analysis-panel'
import { SiteMapList } from './site-map-list'

type SubTab = 'crawler' | 'code'

export function SiteMapTabs({
  projectId,
  status,
}: {
  projectId: string
  status: string
}) {
  const t = useTranslations('projects.overview.map.subtabs')
  const [tab, setTab] = useState<SubTab>('crawler')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
        <SubTabBtn
          active={tab === 'crawler'}
          onClick={() => setTab('crawler')}
          icon={<Globe className="size-4" />}
          label={t('crawler')}
        />
        <SubTabBtn
          active={tab === 'code'}
          onClick={() => setTab('code')}
          icon={<Code2 className="size-4" />}
          label={t('code')}
        />
      </div>

      <section className={cn(tab === 'crawler' ? 'block' : 'hidden')}>
        <SiteMapList projectId={projectId} status={status} />
      </section>

      <section className={cn(tab === 'code' ? 'block' : 'hidden')}>
        <CodeAnalysisPanel projectId={projectId} />
      </section>
    </div>
  )
}

function SubTabBtn({
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
        'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

