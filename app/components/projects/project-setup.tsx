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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Nomes de env vars com UX dedicada no topo do sheet. Todas vivem na
// mesma tabela project_test_env_vars — apenas a UI é diferenciada.
const PRIMARY_NAMES = ['BASE_URL', 'E2E_USER', 'E2E_PASSWORD'] as const
type PrimaryName = (typeof PRIMARY_NAMES)[number]

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
  key: string // UUID local do row (estável durante edição)
  name: string
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

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => Promise<void> | void
}

export function ProjectSetupSheet({
  projectId,
  open,
  onOpenChange,
  onSaved,
}: Props) {
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

    const serverByName = new Map(data.vars.map((v) => [v.name, v]))

    // Garante placeholders dos 3 primary fields mesmo que o server não
    // tenha retornado — assim a QA sempre vê os campos de acesso.
    const primaryItems: LocalVar[] = PRIMARY_NAMES.map((name) => {
      const hit = serverByName.get(name)
      return {
        key: crypto.randomUUID(),
        name,
        valueDraft: '',
        revealed: false,
        hasValueOnServer: hit?.hasValue ?? false,
        detected: hit?.detected ?? false,
        updatedAt: hit?.updatedAt ?? null,
        markedForDelete: false,
      }
    })

    const otherItems: LocalVar[] = data.vars
      .filter((v) => !PRIMARY_NAMES.includes(v.name as PrimaryName))
      .map((v) => ({
        key: crypto.randomUUID(),
        name: v.name,
        valueDraft: '',
        revealed: false,
        hasValueOnServer: v.hasValue,
        detected: v.detected,
        updatedAt: v.updatedAt,
        markedForDelete: false,
      }))

    setItems([...primaryItems, ...otherItems])
    setLoading(false)
  }

  useEffect(() => {
    if (!open) return
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, open])

  const { primary, others, pendingValue } = useMemo(() => {
    const primary = items.filter((i) =>
      PRIMARY_NAMES.includes(i.name as PrimaryName),
    )
    const others = items.filter(
      (i) => !PRIMARY_NAMES.includes(i.name as PrimaryName),
    )
    const pendingValue = items.filter(
      (i) => !i.markedForDelete && i.detected && !i.hasValueOnServer,
    ).length
    return { primary, others, pendingValue }
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
    // Primary fields nunca são "deletados" (sempre presentes como
    // placeholders), só ignorados no payload quando sem valor.
    const deletedNames = items
      .filter(
        (i) =>
          i.markedForDelete &&
          i.hasValueOnServer &&
          !PRIMARY_NAMES.includes(i.name as PrimaryName),
      )
      .map((i) => i.name)

    const varsToSend = items
      .filter((i) => !i.markedForDelete)
      .map((i) => {
        if (i.valueDraft.length > 0) {
          return { name: i.name, value: i.valueDraft }
        }
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
        body: JSON.stringify({ vars: varsToSend, deletedNames }),
      })
      if (!res.ok) {
        toast.error(t('errors.save'))
        return
      }
      toast.success(t('toast_saved'))
      await load()
      await onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto h-[85vh] max-w-4xl rounded-t-xl"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t('heading')}</SheetTitle>
          <SheetDescription className="text-xs">
            {t('description')}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-4">
          {loading ? (
            <div className="space-y-2 pt-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <>
              {pendingValue > 0 ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{t('pending_hint', { count: pendingValue })}</span>
                </div>
              ) : null}

              {/* Credenciais de acesso — campos primários no topo */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('primary_heading')}
                </p>
                <div className="space-y-2 rounded-md border border-border bg-background/40 p-3">
                  {primary.map((item) => (
                    <PrimaryRow
                      key={item.key}
                      item={item}
                      onChangeValue={(v) => updateValue(item.key, v)}
                      onToggleReveal={() => toggleReveal(item.key)}
                    />
                  ))}
                </div>
              </section>

              {/* Outras variáveis — detectadas ou adicionadas manualmente */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('others_heading')}
                </p>
                <div className="rounded-md border border-border bg-background/40">
                  {others.filter((i) => !i.markedForDelete).length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                      {t('empty_others')}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {others
                        .filter((i) => !i.markedForDelete)
                        .map((item) => (
                          <SecondaryRow
                            key={item.key}
                            item={item}
                            onChangeValue={(v) => updateValue(item.key, v)}
                            onToggleReveal={() => toggleReveal(item.key)}
                            onDelete={() => markDelete(item.key)}
                          />
                        ))}
                    </ul>
                  )}

                  <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/20 p-3">
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value.toUpperCase())}
                      placeholder={t('add_name_placeholder')}
                      className="w-48 font-mono"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addNew()
                        }
                      }}
                    />
                    <Input
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      placeholder={t('add_value_placeholder')}
                      type="password"
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addNew()
                        }
                      }}
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
              </section>
            </>
          )}
        </div>

        <SheetFooter className="flex-row items-center justify-end gap-2 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t('close')}
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={saving || loading}>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {t('save')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function PrimaryRow({
  item,
  onChangeValue,
  onToggleReveal,
}: {
  item: LocalVar
  onChangeValue: (v: string) => void
  onToggleReveal: () => void
}) {
  const t = useTranslations('projects.overview.setup')
  const labelKey = `primary_label.${item.name}`
  const hintKey = `primary_hint.${item.name}`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-36 shrink-0">
        <label className="text-xs font-medium">{t(labelKey)}</label>
        <p className="font-mono text-[10px] text-muted-foreground">
          {item.name}
        </p>
      </div>
      <Input
        value={item.valueDraft}
        onChange={(e) => onChangeValue(e.target.value)}
        placeholder={
          item.hasValueOnServer
            ? t('value_placeholder_preserve')
            : t(hintKey)
        }
        type={item.revealed ? 'text' : 'password'}
        className="flex-1 font-mono"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onToggleReveal}
        className="h-8 w-8 shrink-0 p-0"
        title={item.revealed ? t('hide') : t('reveal')}
        aria-label={item.revealed ? t('hide') : t('reveal')}
      >
        {item.revealed ? (
          <EyeOff className="size-3.5" />
        ) : (
          <Eye className="size-3.5" />
        )}
      </Button>
    </div>
  )
}

function SecondaryRow({
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
    <li className="flex items-center gap-2 px-3 py-2">
      <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className={cn(
          'w-40 shrink-0 truncate font-mono text-xs font-medium',
          isMissingValue && 'text-amber-600 dark:text-amber-400',
        )}
        title={item.name}
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
