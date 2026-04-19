'use client'

import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

interface Scenario {
  id: string
  description: string
  priority: number
}

export function ScenariosEditor({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.scenarios')
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, start] = useTransition()

  const load = async () => {
    const res = await fetch(`/api/projects/${projectId}/scenarios`, {
      headers: { 'X-Requested-With': 'fetch' },
    })
    if (!res.ok) return
    const data = (await res.json()) as { items: Scenario[] }
    setScenarios(data.items)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const add = () => {
    const description = draft.trim()
    if (description.length < 4) return
    start(async () => {
      const res = await fetch(`/api/projects/${projectId}/scenarios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({ description, priority: scenarios?.length ?? 0 }),
      })
      if (!res.ok) {
        toast.error(t('errors.create'))
        return
      }
      const row = (await res.json()) as Scenario
      setScenarios((prev) => [...(prev ?? []), row])
      setDraft('')
    })
  }

  const remove = (id: string) => {
    start(async () => {
      const res = await fetch(
        `/api/projects/${projectId}/scenarios/${id}`,
        { method: 'DELETE', headers: { 'X-Requested-With': 'fetch' } },
      )
      if (!res.ok) {
        toast.error(t('errors.delete'))
        return
      }
      setScenarios((prev) => prev?.filter((s) => s.id !== id) ?? null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder={t('placeholder')}
          disabled={pending}
        />
        <Button onClick={add} disabled={pending || draft.trim().length < 4}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t('add')}
        </Button>
      </div>

      {scenarios === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : scenarios.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {scenarios.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <span className="flex-1 text-sm">{s.description}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => remove(s.id)}
                disabled={pending}
                aria-label={t('delete')}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
