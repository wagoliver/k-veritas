'use client'

import { Loader2, X } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { EditableFeature } from './analysis-editor'

export interface FeatureDraft {
  name: string
  description: string
  paths: string[]
}

interface Props {
  projectId: string
  feature: EditableFeature | null
  open: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export function FeatureEditorSheet({
  projectId,
  feature,
  open,
  onClose,
  onSaved,
}: Props) {
  const t = useTranslations('projects.overview.analysis.editor.sheet_feature')
  const isNew = !feature
  const [saving, startSave] = useTransition()

  const [name, setName] = useState(feature?.name ?? '')
  const [description, setDescription] = useState(feature?.description ?? '')
  const [paths, setPaths] = useState<string[]>(feature?.paths ?? [])
  const [draftPath, setDraftPath] = useState('')

  const handleSave = () => {
    if (name.trim().length < 2) {
      toast.error(t('errors.name_min'))
      return
    }
    if (description.trim().length < 5) {
      toast.error(t('errors.description_min'))
      return
    }

    startSave(async () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        paths: paths.map((p) => p.trim()).filter(Boolean),
      }

      const url = isNew
        ? `/api/projects/${projectId}/features`
        : `/api/projects/${projectId}/features/${feature!.id}`
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

  const addPath = () => {
    const v = draftPath.trim()
    if (!v) return
    setPaths((p) => [...p, v])
    setDraftPath('')
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{isNew ? t('title_new') : t('title_edit')}</SheetTitle>
          <SheetDescription>{t('description_hint')}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-6 pb-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('name_label')}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('name_placeholder')}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {t('description_label')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t('description_placeholder')}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('paths_label')}</label>
            {paths.length > 0 ? (
              <ul className="space-y-1">
                {paths.map((p, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Input
                      value={p}
                      onChange={(e) =>
                        setPaths((prev) =>
                          prev.map((it, j) => (j === i ? e.target.value : it)),
                        )
                      }
                      className="flex-1 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPaths((prev) => prev.filter((_, j) => j !== i))
                      }
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
                value={draftPath}
                onChange={(e) => setDraftPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addPath()
                  }
                }}
                placeholder={t('paths_placeholder')}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addPath}
              >
                {t('add_path')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('paths_hint')}</p>
          </div>
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
