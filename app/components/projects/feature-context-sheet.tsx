'use client'

import {
  CheckCircle2,
  Circle,
  Loader2,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { FeatureCard } from './feature-context-cards'

interface Props {
  feature: FeatureCard | null
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void> | void
}

export function FeatureContextSheet({
  feature,
  projectId,
  open,
  onOpenChange,
  onChanged,
}: Props) {
  const t = useTranslations('projects.overview.discovery')

  const [name, setName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [aiUnderstanding, setAiUnderstanding] = useState('')
  const [aiScenarios, setAiScenarios] = useState<string[]>([])
  const [scenarioDraft, setScenarioDraft] = useState('')
  const [approvedAt, setApprovedAt] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const [deleting, startDelete] = useTransition()
  const [approving, startApprove] = useTransition()

  useEffect(() => {
    if (!feature) return
    setName(feature.name)
    setEditingName(false)
    setAiUnderstanding(feature.aiUnderstanding ?? '')
    setAiScenarios(feature.aiScenarios ?? [])
    setScenarioDraft('')
    setApprovedAt(feature.approvedAt)
  }, [feature])

  if (!feature) return null

  const approved = approvedAt !== null

  const addScenario = () => {
    const v = scenarioDraft.trim()
    if (v.length < 4) return
    if (aiScenarios.includes(v)) {
      setScenarioDraft('')
      return
    }
    setAiScenarios((prev) => [...prev, v])
    setScenarioDraft('')
  }

  const removeScenario = (idx: number) => {
    setAiScenarios((prev) => prev.filter((_, i) => i !== idx))
  }

  const editScenario = (idx: number, value: string) => {
    setAiScenarios((prev) =>
      prev.map((s, i) => (i === idx ? value : s)),
    )
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
            aiUnderstanding: aiUnderstanding.trim() || null,
            aiScenarios: aiScenarios
              .map((s) => s.trim())
              .filter((s) => s.length >= 4),
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

  const toggleApprove = () => {
    startApprove(async () => {
      // Se ainda tem alterações não salvas, salva antes de aprovar —
      // senão a QA aprova uma versão "em disco" diferente do que tá na tela.
      const res = await fetch(
        `/api/projects/${projectId}/features/${feature.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({
            aiUnderstanding: aiUnderstanding.trim() || null,
            aiScenarios: aiScenarios
              .map((s) => s.trim())
              .filter((s) => s.length >= 4),
          }),
        },
      )
      if (!res.ok) {
        toast.error(t('errors.save'))
        return
      }

      const approveRes = await fetch(
        `/api/projects/${projectId}/features/${feature.id}/approve`,
        {
          method: approved ? 'DELETE' : 'POST',
          headers: { 'X-Requested-With': 'fetch' },
        },
      )
      if (!approveRes.ok) {
        toast.error(t('errors.approve'))
        return
      }
      const body = (await approveRes.json()) as {
        feature: { approvedAt: string | null }
      }
      setApprovedAt(body.feature.approvedAt)
      toast.success(
        approved ? t('toast_unapproved') : t('toast_approved'),
      )
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
      onOpenChange(false)
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
          {approved ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-fin-gain/10 px-2.5 py-1 text-xs font-medium text-fin-gain">
              <CheckCircle2 className="size-3.5" />
              {t('approved_badge')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Circle className="size-3.5" />
              {t('pending_badge')}
            </span>
          )}
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

          {/* Entendimento da IA */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('field_ai_understanding')}
            </label>
            <p className="text-[11px] text-muted-foreground">
              {t('field_ai_understanding_hint')}
            </p>
            <Textarea
              value={aiUnderstanding}
              onChange={(e) => setAiUnderstanding(e.target.value)}
              placeholder={t('placeholder_ai_understanding')}
              rows={6}
              disabled={saving}
              className="font-mono text-xs leading-relaxed"
            />
          </section>

          {/* Cenários sugeridos */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('field_ai_scenarios')}
            </label>
            <p className="text-[11px] text-muted-foreground">
              {t('field_ai_scenarios_hint')}
            </p>
            <div className="flex gap-2">
              <Input
                value={scenarioDraft}
                onChange={(e) => setScenarioDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addScenario()
                  }
                }}
                placeholder={t('placeholder_ai_scenarios')}
                disabled={saving}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addScenario}
                disabled={saving || scenarioDraft.trim().length < 4}
              >
                {t('scenario_add')}
              </Button>
            </div>
            {aiScenarios.length > 0 ? (
              <ul className="space-y-1.5">
                {aiScenarios.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded border border-border bg-background px-2 py-1.5"
                  >
                    <Textarea
                      value={s}
                      onChange={(e) => editScenario(i, e.target.value)}
                      rows={1}
                      className="flex-1 resize-none border-none bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
                      disabled={saving}
                    />
                    <button
                      type="button"
                      onClick={() => removeScenario(i)}
                      className="shrink-0 opacity-60 hover:opacity-100"
                      disabled={saving}
                      aria-label={t('scenario_remove')}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <SheetFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={removeFeature}
            disabled={deleting || saving || approving}
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
              onClick={() => save(false)}
              disabled={saving || deleting || approving}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              {t('save')}
            </Button>
            <Button
              size="sm"
              onClick={toggleApprove}
              disabled={saving || deleting || approving}
              variant={approved ? 'outline' : 'default'}
              className={cn(approved && 'border-fin-gain text-fin-gain')}
            >
              {approving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              {approved ? t('unapprove') : t('approve')}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
