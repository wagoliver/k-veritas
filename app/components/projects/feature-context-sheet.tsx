'use client'

import {
  CheckCircle2,
  Focus,
  Loader2,
  Pencil,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ScenariosEditor } from './scenarios-editor'
import type { CoveragePriority, FeatureCard } from './feature-context-cards'

interface Props {
  feature: FeatureCard | null
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void> | void
}

const PRIORITY_OPTIONS: CoveragePriority[] = [
  'critical',
  'high',
  'normal',
  'low',
]

const PRIORITY_COLORS: Record<CoveragePriority, string> = {
  critical: 'text-destructive',
  high: 'text-orange-600 dark:text-orange-400',
  normal: 'text-foreground',
  low: 'text-muted-foreground',
}

export function FeatureContextSheet({
  feature,
  projectId,
  open,
  onOpenChange,
  onChanged,
}: Props) {
  const t = useTranslations('projects.overview.discovery')

  // Re-hydrata ao trocar de feature ou reabrir o sheet.
  const [businessRule, setBusinessRule] = useState('')
  const [testRestrictions, setTestRestrictions] = useState('')
  const [codeFocus, setCodeFocus] = useState<FeatureCard['codeFocus']>([])
  const [envVars, setEnvVars] = useState<string[]>([])
  const [priorities, setPriorities] = useState<CoveragePriority[]>([])
  const [name, setName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [envVarDraft, setEnvVarDraft] = useState('')
  const [focusDraft, setFocusDraft] = useState('')
  const [saving, startSave] = useTransition()
  const [deleting, startDelete] = useTransition()
  const [generating, startGenerate] = useTransition()

  useEffect(() => {
    if (!feature) return
    setBusinessRule(feature.businessRule ?? '')
    setTestRestrictions(feature.testRestrictions ?? '')
    setCodeFocus(feature.codeFocus ?? [])
    setEnvVars(feature.expectedEnvVars ?? [])
    setPriorities(feature.coveragePriorities ?? [])
    setName(feature.name)
    setEditingName(false)
    setEnvVarDraft('')
    setFocusDraft('')
  }, [feature])

  if (!feature) return null

  const togglePriority = (p: CoveragePriority) => {
    setPriorities((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    )
  }

  const addFocus = (mode: 'focus' | 'ignore') => {
    const path = focusDraft.trim()
    if (path.length === 0) return
    setCodeFocus((prev) => [...prev, { path, mode }])
    setFocusDraft('')
  }

  const removeFocus = (idx: number) => {
    setCodeFocus((prev) => prev.filter((_, i) => i !== idx))
  }

  const addEnvVar = () => {
    const v = envVarDraft.trim().toUpperCase()
    if (!/^[A-Z_][A-Z0-9_]*$/.test(v)) return
    if (envVars.includes(v)) {
      setEnvVarDraft('')
      return
    }
    setEnvVars((prev) => [...prev, v])
    setEnvVarDraft('')
  }

  const removeEnvVar = (v: string) => {
    setEnvVars((prev) => prev.filter((x) => x !== v))
  }

  const save = (closeAfter = false) => {
    startSave(async () => {
      const res = await fetch(
        `/api/projects/${projectId}/features/${feature.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({
            name: editingName ? name.trim() : undefined,
            businessRule: businessRule.trim() || null,
            testRestrictions: testRestrictions.trim() || null,
            codeFocus,
            expectedEnvVars: envVars,
            coveragePriorities: priorities,
          }),
        },
      )
      if (!res.ok) {
        toast.error(t('errors.save'))
        return
      }
      toast.success(t('toast_saved'))
      setEditingName(false)
      await onChanged()
      if (closeAfter) onOpenChange(false)
    })
  }

  const removeFeature = () => {
    if (!confirm(t('confirm_delete'))) return
    startDelete(async () => {
      const res = await fetch(
        `/api/projects/${projectId}/features/${feature.id}`,
        {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'fetch' },
        },
      )
      if (!res.ok) {
        toast.error(t('errors.delete'))
        return
      }
      toast.success(t('toast_deleted'))
      onOpenChange(false)
      await onChanged()
    })
  }

  const generateForFeature = () => {
    startGenerate(async () => {
      // Salva contexto atual antes pra garantir que vai pro prompt
      await new Promise<void>((resolve) => {
        startSave(async () => {
          await fetch(`/api/projects/${projectId}/features/${feature.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'fetch',
            },
            body: JSON.stringify({
              businessRule: businessRule.trim() || null,
              testRestrictions: testRestrictions.trim() || null,
              codeFocus,
              expectedEnvVars: envVars,
              coveragePriorities: priorities,
            }),
          })
          resolve()
        })
      })

      const res = await fetch(
        `/api/projects/${projectId}/features/${feature.id}/generate-tests`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({}),
        },
      )
      if (!res.ok) {
        toast.error(t('errors.generate', { name: feature.name }))
        return
      }
      toast.success(t('toast_generate_done'))
      await onChanged()
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('sheet_title')}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {/* Nome */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('field_name')}
            </label>
            {editingName ? (
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  disabled={saving}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setName(feature.name)
                    setEditingName(false)
                  }}
                  disabled={saving}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-medium">{name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingName(true)}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {feature.paths.map((p) => (
                <span
                  key={p}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {p}
                </span>
              ))}
            </div>
          </section>

          {/* Regra de negócio */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('field_business_rule')}
            </label>
            <Textarea
              value={businessRule}
              onChange={(e) => setBusinessRule(e.target.value)}
              placeholder={t('placeholder_business_rule')}
              rows={4}
              disabled={saving}
            />
          </section>

          {/* Cenários livres */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('field_free_scenarios')}
            </label>
            <ScenariosEditor
              projectId={projectId}
              scope={{ kind: 'feature', featureId: feature.id }}
            />
          </section>

          {/* Restrições */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('field_test_restrictions')}
            </label>
            <Textarea
              value={testRestrictions}
              onChange={(e) => setTestRestrictions(e.target.value)}
              placeholder={t('placeholder_test_restrictions')}
              rows={3}
              disabled={saving}
            />
          </section>

          {/* Code focus */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('field_code_focus')}
            </label>
            <div className="flex gap-2">
              <Input
                value={focusDraft}
                onChange={(e) => setFocusDraft(e.target.value)}
                placeholder={t('placeholder_code_focus')}
                disabled={saving}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => addFocus('focus')}
                disabled={saving || focusDraft.trim().length === 0}
                title={t('focus_add_focus')}
              >
                <Focus className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => addFocus('ignore')}
                disabled={saving || focusDraft.trim().length === 0}
                title={t('focus_add_ignore')}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            {codeFocus.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {codeFocus.map((item, i) => (
                  <li
                    key={i}
                    className={cn(
                      'inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px]',
                      item.mode === 'focus'
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-destructive/40 bg-destructive/10 text-destructive',
                    )}
                  >
                    {item.mode === 'focus' ? '+' : '-'} {item.path}
                    <button
                      type="button"
                      onClick={() => removeFocus(i)}
                      className="ml-1 opacity-60 hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Env vars */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('field_env_vars')}
            </label>
            <div className="flex gap-2">
              <Input
                value={envVarDraft}
                onChange={(e) => setEnvVarDraft(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addEnvVar()
                  }
                }}
                placeholder={t('placeholder_env_vars')}
                className="font-mono"
                disabled={saving}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={addEnvVar}
                disabled={saving || envVarDraft.trim().length === 0}
              >
                {t('add')}
              </Button>
            </div>
            {envVars.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {envVars.map((v) => (
                  <li
                    key={v}
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px]"
                  >
                    {v}
                    <button
                      type="button"
                      onClick={() => removeEnvVar(v)}
                      className="ml-1 opacity-60 hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Prioridades */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('field_priorities')}
            </label>
            <div className="flex flex-wrap gap-3">
              {PRIORITY_OPTIONS.map((p) => (
                <label
                  key={p}
                  className="flex cursor-pointer items-center gap-1.5 text-sm"
                >
                  <Checkbox
                    checked={priorities.includes(p)}
                    onCheckedChange={() => togglePriority(p)}
                    disabled={saving}
                  />
                  <span className={cn('capitalize', PRIORITY_COLORS[p])}>{p}</span>
                </label>
              ))}
            </div>
          </section>
        </div>

        <SheetFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={removeFeature}
            disabled={deleting || saving || generating}
            className="text-destructive hover:text-destructive"
          >
            {deleting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            {t('delete')}
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={generateForFeature}
              disabled={generating || saving || deleting}
            >
              {generating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {t('generate_tests_feature')}
            </Button>
            <Button
              size="sm"
              onClick={() => save(true)}
              disabled={saving || deleting || generating}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              {t('save')}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
