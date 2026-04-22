'use client'

import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface EnvVarMeta {
  name: string
  hasValue: boolean
  detected: boolean
  updatedAt: string | null
}

interface ServerResponse {
  vars: EnvVarMeta[]
}

interface LocalVar {
  key: string // chave estável do row (UUID local)
  name: string
  // valor em memória da sessão. Nunca vem do servidor (valores são sempre
  // mascarados). Empty string = "não mexer"; undefined = "apagar" (via flag).
  valueDraft: string
  revealed: boolean
  hasValueOnServer: boolean
  detected: boolean
  updatedAt: string | null
  markedForDelete: boolean
}

function sanitizeName(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

const NAME_REGEX = /^[A-Z_][A-Z0-9_]*$/

export function ProjectSetup({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.setup')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [items, setItems] = useState<LocalVar[]>([])
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')

  const load = async () => {
    const res = await fetch(`/api/projects/${projectId}/test-env-vars`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
    if (!res.ok) {
      toast.error(t('errors.load'))
      setLoading(false)
      return
    }
    const data = (await res.json()) as ServerResponse
    setItems(
      data.vars.map((v) => ({
        key: crypto.randomUUID(),
        name: v.name,
        valueDraft: '',
        revealed: false,
        hasValueOnServer: v.hasValue,
        detected: v.detected,
        updatedAt: v.updatedAt,
        markedForDelete: false,
      })),
    )
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const stats = useMemo(() => {
    const pendingValue = items.filter(
      (i) => !i.markedForDelete && i.detected && !i.hasValueOnServer,
    ).length
    const total = items.filter((i) => !i.markedForDelete).length
    return { total, pendingValue }
  }, [items])

  const addNew = () => {
    const name = sanitizeName(newName)
    if (!NAME_REGEX.test(name)) {
      toast.error(t('errors.invalid_name'))
      return
    }
    if (items.some((i) => i.name === name && !i.markedForDelete)) {
      toast.error(t('errors.duplicate_name'))
      return
    }
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        name,
        valueDraft: newValue,
        revealed: false,
        hasValueOnServer: false,
        detected: false,
        updatedAt: null,
        markedForDelete: false,
      },
    ])
    setNewName('')
    setNewValue('')
  }

  const updateValue = (key: string, value: string) => {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, valueDraft: value } : i)),
    )
  }

  const toggleReveal = (key: string) => {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, revealed: !i.revealed } : i)),
    )
  }

  const markDelete = (key: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.key === key ? { ...i, markedForDelete: !i.markedForDelete } : i,
      ),
    )
  }

  const save = async () => {
    setSaving(true)
    const deletedNames = items
      .filter((i) => i.markedForDelete && i.hasValueOnServer)
      .map((i) => i.name)

    const varsToSend = items
      .filter((i) => !i.markedForDelete)
      .map((i) => {
        // Envia value só se a QA digitou algo — valor vazio string (fora o
        // novo cadastro com valueDraft='') significa "preserva o existente".
        if (i.valueDraft.length > 0) {
          return { name: i.name, value: i.valueDraft }
        }
        // Var nova sem valor ainda não tem sentido cadastrar — pula.
        if (!i.hasValueOnServer) return null
        return { name: i.name }
      })
      .filter((v): v is { name: string; value?: string } => v !== null)

    try {
      const res = await fetch(`/api/projects/${projectId}/test-env-vars`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({
          vars: varsToSend,
          deletedNames,
        }),
      })
      if (!res.ok) {
        toast.error(t('errors.save'))
        return
      }
      toast.success(t('toast_saved'))
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    )
  }

  const visible = items.filter((i) => !i.markedForDelete)
  const deletedCount = items.filter((i) => i.markedForDelete).length

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg font-semibold">{t('heading')}</h2>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </header>

      {stats.pendingValue > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('pending_hint', { count: stats.pendingValue })}</span>
        </div>
      ) : null}

      <div className="surface-card overflow-hidden rounded-xl">
        <div className="border-b border-border/60 bg-card/60 px-4 py-2.5 text-xs font-medium text-muted-foreground">
          {t('table_summary', { count: stats.total })}
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t('empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {visible.map((item) => (
              <VarRow
                key={item.key}
                item={item}
                onChangeValue={(v) => updateValue(item.key, v)}
                onToggleReveal={() => toggleReveal(item.key)}
                onDelete={() => markDelete(item.key)}
              />
            ))}
          </ul>
        )}

        <div className="space-y-2 border-t border-border/60 bg-muted/20 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t('add_heading')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value.toUpperCase())}
              placeholder={t('add_name_placeholder')}
              className="w-56 font-mono"
            />
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={t('add_value_placeholder')}
              type="password"
              className="flex-1"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addNew}
              disabled={newName.trim().length === 0}
            >
              <Plus className="size-3.5" />
              {t('add_button')}
            </Button>
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {deletedCount > 0
            ? t('pending_delete', { count: deletedCount })
            : t('footer_hint')}
        </p>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          {t('save')}
        </Button>
      </footer>
    </section>
  )
}

function VarRow({
  item,
  onChangeValue,
  onToggleReveal,
  onDelete,
}: {
  item: LocalVar
  onChangeValue: (v: string) => void
  onToggleReveal: () => void
  onDelete: () => void
}) {
  const t = useTranslations('projects.overview.setup')
  const isMissingValue = !item.hasValueOnServer && item.valueDraft.length === 0

  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className={cn(
          'shrink-0 font-mono text-xs font-medium',
          isMissingValue && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {item.name}
      </span>
      {item.detected ? (
        <span
          className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary"
          title={t('detected_tooltip')}
        >
          {t('detected_badge')}
        </span>
      ) : null}
      <Input
        value={item.valueDraft}
        onChange={(e) => onChangeValue(e.target.value)}
        placeholder={
          item.hasValueOnServer
            ? t('value_placeholder_preserve')
            : t('value_placeholder_set')
        }
        type={item.revealed ? 'text' : 'password'}
        className="flex-1 font-mono"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onToggleReveal}
        className="h-7 w-7 shrink-0 p-0"
        title={item.revealed ? t('hide') : t('reveal')}
        aria-label={item.revealed ? t('hide') : t('reveal')}
      >
        {item.revealed ? (
          <EyeOff className="size-3.5" />
        ) : (
          <Eye className="size-3.5" />
        )}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDelete}
        className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
        title={t('delete')}
        aria-label={t('delete')}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  )
}
