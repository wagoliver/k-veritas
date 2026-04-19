'use client'

import { Check, Loader2, Plus, X } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

/**
 * Botão + input inline pra o usuário adicionar manualmente um path que
 * o crawler não descobriu. Dispara o job single_path direto. O novo path
 * aparece na lista assim que o worker concluir (polling já existe).
 */
export function AddPathInput({
  projectId,
  onAdded,
}: {
  projectId: string
  onAdded?: () => void
}) {
  const t = useTranslations('projects.overview.map.add_path')
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [pending, start] = useTransition()

  const submit = () => {
    const trimmed = value.trim()
    if (trimmed.length === 0) return
    start(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/crawls`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({ scope: 'single_path', url: trimmed }),
        })
        if (res.status === 400) {
          toast.error(t('errors.invalid_path'))
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
        toast.success(t('enqueued'))
        setValue('')
        setOpen(false)
        setTimeout(() => onAdded?.(), 3000)
      } catch {
        toast.error(t('errors.network'))
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Plus className="size-3.5" />
        {t('button')}
      </button>
    )
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-background px-1.5 py-0.5 shadow-sm">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') {
            setValue('')
            setOpen(false)
          }
        }}
        autoFocus
        disabled={pending}
        placeholder={t('placeholder')}
        className="w-48 bg-transparent px-1.5 py-1 font-mono text-xs outline-hidden placeholder:text-muted-foreground/50"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || value.trim().length === 0}
        title={t('submit')}
        aria-label={t('submit')}
        className={cn(
          'inline-flex size-6 items-center justify-center rounded text-primary transition-colors',
          'hover:bg-primary/10 disabled:opacity-40',
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={() => {
          setValue('')
          setOpen(false)
        }}
        disabled={pending}
        title={t('cancel')}
        aria-label={t('cancel')}
        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
