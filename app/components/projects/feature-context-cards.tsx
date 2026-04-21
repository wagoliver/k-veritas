'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Focus,
  Loader2,
  Pencil,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ScenariosEditor } from './scenarios-editor'

type CoveragePriority = 'critical' | 'high' | 'normal' | 'low'

interface CodeFocusItem {
  path: string
  mode: 'focus' | 'ignore'
}

interface FeatureCard {
  id: string
  externalId: string
  name: string
  description: string
  paths: string[]
  source: 'ai' | 'manual'
  businessRule: string | null
  testRestrictions: string | null
  codeFocus: CodeFocusItem[]
  expectedEnvVars: string[]
  coveragePriorities: CoveragePriority[]
  contextUpdatedAt: string | null
}

interface FeaturesResponse {
  features: FeatureCard[]
}

export function FeatureContextCards({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.overview.discovery')
  const [features, setFeatures] = useState<FeatureCard[] | null>(null)

  const load = async () => {
    const res = await fetch(`/api/projects/${projectId}/features`, {
      headers: { 'X-Requested-With': 'fetch' },
      cache: 'no-store',
    })
    if (!res.ok) {
      toast.error(t('errors.load'))
      return
    }
    const data = (await res.json()) as FeaturesResponse
    setFeatures(data.features)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  if (features === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    )
  }

  if (features.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    )
  }

  const filled = features.filter(
    (f) => f.contextUpdatedAt !== null,
  ).length

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">
            {t('heading')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t('summary', { filled, total: features.length })}
          </p>
        </div>
      </header>

      <ul className="space-y-3">
        {features.map((f) => (
          <FeatureCardItem
            key={f.id}
            feature={f}
            projectId={projectId}
            onChanged={load}
          />
        ))}
      </ul>
    </div>
  )
}

function FeatureCardItem({
  feature,
  projectId,
  onChanged,
}: {
  feature: FeatureCard
  projectId: string
  onChanged: () => Promise<void> | void
}) {
  const t = useTranslations('projects.overview.discovery')
  const [open, setOpen] = useState(false)
  const contextFilled = feature.contextUpdatedAt !== null

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-accent/20"
      >
        <ChevronRight
          className={cn(
            'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-semibold">
              {feature.name}
            </span>
            {contextFilled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-fin-gain/10 px-2 py-0.5 text-[10px] font-medium text-fin-gain">
                <CheckCircle2 className="size-3" />
                {t('badge_context_filled')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <AlertTriangle className="size-3" />
                {t('badge_context_pending')}
              </span>
            )}
            {feature.source === 'manual' ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {t('badge_manual')}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {feature.description}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {feature.paths.map((p) => (
              <span
                key={p}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </button>

      {open ? (
        <ContextEditor
          feature={feature}
          projectId={projectId}
          onChanged={onChanged}
        />
      ) : null}
    </li>
  )
}

function ContextEditor({
  feature,
  projectId,
  onChanged,
}: {
  feature: FeatureCard
  projectId: string
  onChanged: () => Promise<void> | void
}) {
  const t = useTranslations('projects.overview.discovery')
  const [businessRule, setBusinessRule] = useState(
    feature.businessRule ?? '',
  )
  const [testRestrictions, setTestRestrictions] = useState(
    feature.testRestrictions ?? '',
  )
  const [codeFocus, setCodeFocus] = useState<CodeFocusItem[]>(
    feature.codeFocus ?? [],
  )
  const [envVarDraft, setEnvVarDraft] = useState('')
  const [envVars, setEnvVars] = useState<string[]>(
    feature.expectedEnvVars ?? [],
  )
  const [priorities, setPriorities] = useState<CoveragePriority[]>(
    feature.coveragePriorities ?? [],
  )
  const [saving, startSave] = useTransition()
  const [deleting, startDelete] = useTransition()
  const [name, setName] = useState(feature.name)
  const [editingName, setEditingName] = useState(false)
  const [focusDraft, setFocusDraft] = useState('')

  const priorityOptions: CoveragePriority[] = [
    'critical',
    'high',
    'normal',
    'low',
  ]

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

  const save = () => {
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
      await onChanged()
    })
  }

  return (
    <div className="space-y-5 border-t border-border bg-muted/20 p-4">
      {/* Nome (editável) */}
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
            <span className="text-sm">{name}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditingName(true)}
            >
              <Pencil className="size-3.5" />
            </Button>
          </div>
        )}
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

      {/* Cenários livres (reuso) */}
      <section className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          {t('field_free_scenarios')}
        </label>
        <ScenariosEditor
          projectId={projectId}
          scope={{ kind: 'feature', featureId: feature.id }}
        />
      </section>

      {/* Restrições de teste */}
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

      {/* Áreas do código (focus/ignore) */}
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

      {/* Env vars esperadas */}
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

      {/* Prioridades de cobertura */}
      <section className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          {t('field_priorities')}
        </label>
        <div className="flex flex-wrap gap-3">
          {priorityOptions.map((p) => (
            <label
              key={p}
              className="flex items-center gap-1.5 text-sm cursor-pointer"
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

      {/* Ações */}
      <div className="flex items-center justify-between border-t border-border/40 pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={removeFeature}
          disabled={deleting || saving}
          className="text-destructive hover:text-destructive"
        >
          {deleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          {t('delete')}
        </Button>
        <Button onClick={save} disabled={saving || deleting}>
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
          {t('save')}
        </Button>
      </div>
    </div>
  )
}

const PRIORITY_COLORS: Record<CoveragePriority, string> = {
  critical: 'text-destructive',
  high: 'text-orange-600 dark:text-orange-400',
  normal: 'text-foreground',
  low: 'text-muted-foreground',
}
