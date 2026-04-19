'use client'

import { Loader2, X } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { EditableScenario } from './analysis-editor'

export interface ScenarioDraft {
  title: string
  rationale: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  preconditions: string[]
  dataNeeded: string[]
}

interface Props {
  projectId: string
  featureId: string
  scenario: EditableScenario | null
  open: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export function ScenarioEditorSheet({
  projectId,
  featureId,
  scenario,
  open,
  onClose,
  onSaved,
}: Props) {
  const t = useTranslations('projects.overview.analysis.editor.sheet_scenario')
  const isNew = !scenario
  const [saving, startSave] = useTransition()

  const [title, setTitle] = useState(scenario?.title ?? '')
  const [rationale, setRationale] = useState(scenario?.rationale ?? '')
  const [priority, setPriority] = useState<ScenarioDraft['priority']>(
    scenario?.priority ?? 'normal',
  )
  const [preconditions, setPreconditions] = useState<string[]>(
    scenario?.preconditions ?? [],
  )
  const [dataNeeded, setDataNeeded] = useState<string[]>(
    scenario?.dataNeeded ?? [],
  )

  const handleSave = () => {
    if (title.trim().length < 4) {
      toast.error(t('errors.title_min'))
      return
    }
    if (rationale.trim().length < 5) {
      toast.error(t('errors.rationale_min'))
      return
    }

    startSave(async () => {
      const body = {
        title: title.trim(),
        rationale: rationale.trim(),
        priority,
        preconditions: preconditions.map((p) => p.trim()).filter(Boolean),
        dataNeeded: dataNeeded.map((p) => p.trim()).filter(Boolean),
      }

      const url = isNew
        ? `/api/projects/${projectId}/features/${featureId}/scenarios`
        : `/api/projects/${projectId}/ai-scenarios/${scenario!.id}`
      const method = isNew ? 'POST' : 'PATCH'

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        toast.error(t('errors.save'))
        return
      }
      toast.success(isNew ? t('created') : t('updated'))
      await onSaved()
    })
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{isNew ? t('title_new') : t('title_edit')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-6 pb-6">
          <FormRow label={t('title_label')}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('title_placeholder')}
              autoFocus
            />
          </FormRow>

          <FormRow
            label={t('rationale_label')}
            hint={t('rationale_hint')}
          >
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              placeholder={t('rationale_placeholder')}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </FormRow>

          <FormRow label={t('priority_label')}>
            <Select
              value={priority}
              onValueChange={(v) => setPriority(v as ScenarioDraft['priority'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="critical">{t('priority.critical')}</SelectItem>
                <SelectItem value="high">{t('priority.high')}</SelectItem>
                <SelectItem value="normal">{t('priority.normal')}</SelectItem>
                <SelectItem value="low">{t('priority.low')}</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>

          <StringListEditor
            label={t('preconditions_label')}
            hint={t('preconditions_hint')}
            placeholder={t('preconditions_placeholder')}
            items={preconditions}
            onChange={setPreconditions}
          />

          <StringListEditor
            label={t('data_needed_label')}
            hint={t('data_needed_hint')}
            placeholder={t('data_needed_placeholder')}
            items={dataNeeded}
            onChange={setDataNeeded}
          />
        </div>

        <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {isNew ? t('create') : t('save')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function FormRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

function StringListEditor({
  label,
  hint,
  placeholder,
  items,
  onChange,
}: {
  label: string
  hint?: string
  placeholder: string
  items: string[]
  onChange: (items: string[]) => void
}) {
  const t = useTranslations('projects.overview.analysis.editor.sheet_scenario')
  const [draft, setDraft] = useState('')

  const add = () => {
    const v = draft.trim()
    if (v.length === 0) return
    onChange([...items, v])
    setDraft('')
  }

  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx))
  }

  const update = (idx: number, value: string) => {
    onChange(items.map((it, i) => (i === idx ? value : it)))
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2">
              <Input
                value={it}
                onChange={(e) => update(i, e.target.value)}
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={t('remove_item')}
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground',
                  'transition-colors hover:bg-destructive/10 hover:text-destructive',
                )}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          {t('add_item')}
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
