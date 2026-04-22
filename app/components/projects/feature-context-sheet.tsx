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
import { DateTime } from '@/components/ui/date-time'
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
import type { FeatureCard, ScenarioPriority } from './feature-context-cards'

const PRIORITY_CLASSES: Record<ScenarioPriority, string> = {
  critical: 'bg-destructive/15 text-destructive',
  high: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  normal: 'bg-primary/15 text-primary',
  low: 'bg-muted text-muted-foreground',
}

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
  const [approvedAt, setApprovedAt] = useState<string | null>(null)
  const [approvedBy, setApprovedBy] = useState<{
    id: string
    displayName: string
  } | null>(null)
  // Snapshot read-only dos cenários (preview). Edição vive na tela Cenário.
  const scenarios = feature?.aiScenarios ?? []
  const [saving, startSave] = useTransition()
  const [deleting, startDelete] = useTransition()
  const [approving, startApprove] = useTransition()

  useEffect(() => {
    if (!feature) return
    setName(feature.name)
    setEditingName(false)
    setAiUnderstanding(feature.aiUnderstanding ?? '')
    setApprovedAt(feature.approvedAt)
    setApprovedBy(feature.approvedBy)
  }, [feature])

  if (!feature) return null

  const approved = approvedAt !== null

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
      // Salva entendimento antes de aprovar pra evitar aprovar versão
      // "em disco" diferente do que tá na tela.
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
      setApprovedAt(approved ? null : new Date().toISOString())
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
          <div className="flex flex-col items-end gap-1">
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
            {approved && approvedAt && approvedBy ? (
              <p className="flex items-center gap-1 text-[11px] text-fin-gain">
                <span>
                  {t('approved_by_prefix', { name: approvedBy.displayName })}
                </span>
                <DateTime value={approvedAt} />
              </p>
            ) : null}
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

          {/* Cenários sugeridos (preview read-only — edição vive em Cenário) */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('field_ai_scenarios')}
            </label>
            <p className="text-[11px] text-muted-foreground">
              {t('field_ai_scenarios_readonly_hint')}
            </p>
            {scenarios.length > 0 ? (
              <ul className="space-y-1">
                {scenarios.map((s) => (
                  <li
                    key={s.id ?? s.description}
                    className="flex items-start gap-2 rounded border border-border/60 bg-background/40 px-2 py-1.5"
                  >
                    <span
                      className={cn(
                        'mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                        PRIORITY_CLASSES[s.priority],
                      )}
                    >
                      {t(`priority.${s.priority}`)}
                    </span>
                    <span className="flex-1 text-xs leading-snug">
                      {s.description}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground/70">
                {t('field_ai_scenarios_empty')}
              </p>
            )}
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
