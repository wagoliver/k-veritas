'use client'

import { useEffect, useState, useTransition } from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface Session {
  id: string
  userAgent: string | null
  ip: string | null
  createdAt: string
  expiresAt: string
  mfaLevel: string
  isCurrent: boolean
}

function guessDeviceIcon(userAgent: string | null) {
  if (!userAgent) return Monitor
  return /Mobile|Android|iPhone|iPad/i.test(userAgent) ? Smartphone : Monitor
}

function simplifyUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  const parts: string[] = []
  const browser =
    userAgent.match(/(Firefox|Chrome|Safari|Edge|OPR)\/([\d.]+)/)?.[0]
  const os =
    userAgent.match(/Windows|Macintosh|Linux|Android|iPhone|iPad/)?.[0]
  if (browser) parts.push(browser)
  if (os) parts.push(os.replace('Macintosh', 'macOS'))
  return parts.length > 0 ? parts.join(' · ') : userAgent.slice(0, 80)
}

export function SessionsList() {
  const t = useTranslations('settings.security.sessions')
  const format = useFormatter()
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [pending, start] = useTransition()

  const load = () => {
    start(async () => {
      const res = await fetch('/api/auth/sessions', {
        headers: { 'X-Requested-With': 'fetch' },
      })
      if (!res.ok) {
        toast.error(t('errors.load'))
        return
      }
      const data = (await res.json()) as { items: Session[] }
      setSessions(data.items)
    })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const revoke = (id: string) => {
    start(async () => {
      const res = await fetch(`/api/auth/sessions/${id}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'fetch' },
      })
      if (!res.ok) {
        toast.error(t('errors.revoke'))
        return
      }
      toast.success(t('revoked'))
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null)
    })
  }

  if (sessions === null) {
    return (
      <ul className="space-y-2">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-md border border-border p-3"
          >
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className="space-y-2">
      {sessions.map((s) => {
        const Icon = guessDeviceIcon(s.userAgent)
        return (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {simplifyUserAgent(s.userAgent)}
                {s.isCurrent ? (
                  <span className="ml-2 rounded-md bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
                    {t('current')}
                  </span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {s.ip ?? 'IP ?'} ·{' '}
                {format.dateTime(new Date(s.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </div>
            {!s.isCurrent ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => revoke(s.id)}
                disabled={pending}
              >
                {t('revoke')}
              </Button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
