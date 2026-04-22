'use client'

import {
  CheckCircle2,
  ChevronRight,
  Focus,
  Loader2,
  Pencil,
  Play,
  Sparkles,
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
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  ModelPicker,
  useOrgPrimaryConfig,
  usePersistedModel,
} from './model-picker'
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
  // "Avançado" só abre automático quando a feature já tem algum campo
  // não-essencial preenchido — sinaliza que a QA usou aquilo antes.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [modelOverride, setModelOverride] = usePersistedModel(
    `model:${projectId}:generate-tests`,
  )
  const orgCfg = useOrgPrimaryConfig()
  const [suggesting, startSuggesting] = useTransition()

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
    // Abre "Avançado" se já tem algum campo não-essencial preenchido.
    const hasAdvanced =
      (feature.testRestrictions?.trim().length ?? 0) > 0 ||
      (feature.codeFocus?.length ?? 0) > 0 ||
      (feature.expectedEnvVars?.length ?? 0) > 0 ||
      (feature.coveragePriorities?.length ?? 0) > 0
    setAdvancedOpen(hasAdvanced)
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

  const suggestWithAi = () => {
    startSuggesting(async () => {
      const res = await fetch(
        `/api/projects/${projectId}/features/${feature.id}/suggest-context`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify(
            modelOverride ? { model: modelOverride } : {},
          ),
        },
      )
      if (!res.ok) {
        toast.error(t('errors.suggest'))
        return
      }
      const body = (await res.json()) as {
        suggestion: {
          businessRule?: string | null
          freeScenarios?: string[]
          testRestrictions?: string | null
          expectedEnvVars?: string[]
        }
      }
      const s = body.suggestion

      // Preenche só campos vazios — nunca sobrescreve trabalho da QA.
      let filledAny = false
      if (s.businessRule && businessRule.trim().length === 0) {
        setBusinessRule(s.businessRule)
        filledAny = true
      }
      if (s.testRestrictions && testRestrictions.trim().length === 0) {
        setTestRestrictions(s.testRestrictions)
        filledAny = true
      }
      if (s.expectedEnvVars && s.expectedEnvVars.length > 0) {
        const missing = s.expectedEnvVars.filter((v) => !envVars.includes(v))
        if (missing.length > 0) {
          setEnvVars((prev) => [...prev, ...missing])
          filledAny = true
        }
      }
      // Cenários livres: só adiciona os NÃO-duplicados, via POST direto
      // (reusa a API que já persiste, consistente com o ScenariosEditor).
      if (s.freeScenarios && s.freeScenarios.length > 0) {
        for (const desc of s.freeScenarios) {
          await fetch(
            `/api/projects/${projectId}/features/${feature.id}/free-scenarios`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'fetch',
              },
              body: JSON.stringify({ description: desc, priority: 0 }),
            },
          ).catch(() => {})
        }
        filledAny = true
      }

      if (filledAny) {
        toast.success(t('toast_suggested'))
        // Expande avançado se alguma coisa caiu lá.
        if (
          (s.testRestrictions && testRestrictions.trim().length === 0) ||
          (s.expectedEnvVars && s.expectedEnvVars.length > 0)
        ) {
          setAdvancedOpen(true)
        }
        // Recarrega os free scenarios via onChanged (re-fetcha features + counts)
        await onChanged()
      } else {
        toast.info(t('toast_suggested_empty'))
      }
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
          body: JSON.stringify(
            modelOverride ? { model: modelOverride } : {},
          ),
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
      <SheetContent
        side="bottom"
        className="mx-auto h-[85vh] max-w-4xl rounded-t-xl"
      >
        <SheetHeader className="flex-row flex-wrap items-center justify-between gap-2 border-b border-border">
          <div className="min-w-0 flex-1">
            <SheetTitle>{t('sheet_title')}</SheetTitle>
            <SheetDescription className="sr-only">
              {feature.name}
            </SheetDescription>
          </div>
          <div className="flex items-center gap-1">
            {orgCfg ? (
              <ModelPicker
                value={modelOverride}
                onChange={setModelOverride}
                provider={orgCfg.provider}
                baseUrl={orgCfg.baseUrl}
                defaultModel={orgCfg.defaultModel}
                compact
              />
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={suggestWithAi}
              disabled={suggesting || saving || deleting || generating}
            >
              {suggesting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {t('suggest_with_ai')}
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-4">
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

          {/* Avançado: colapsado por padrão. Contém os 4 campos opcionais
              que 90% das QAs não precisam mexer. */}
          <section className="rounded-lg border border-border/60 bg-background/50">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              aria-expanded={advancedOpen}
            >
              <ChevronRight
                className={cn(
                  'size-3.5 transition-transform',
                  advancedOpen && 'rotate-90',
                )}
              />
              <span className="font-semibold uppercase tracking-wider">
                {t('advanced_toggle')}
              </span>
              <span className="text-[10px] font-normal normal-case tracking-normal opacity-70">
                {t('advanced_hint')}
              </span>
            </button>

            {advancedOpen ? (
              <div className="space-y-5 border-t border-border/60 px-3 py-4">
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
                      onChange={(e) =>
                        setEnvVarDraft(e.target.value.toUpperCase())
                      }
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
                        <span className={cn('capitalize', PRIORITY_COLORS[p])}>
                          {p}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}
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
