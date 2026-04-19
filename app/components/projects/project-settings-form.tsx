'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useRouter } from '@/lib/i18n/navigation'

const TARGET_LOCALES = ['pt-BR', 'en-US', 'es-ES', 'fr-FR', 'de-DE'] as const
type TargetLocale = (typeof TARGET_LOCALES)[number]

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  targetUrl: z.string().trim().url(),
  description: z.string().trim().max(4000).optional().or(z.literal('')),
  crawlMaxDepth: z.coerce.number().int().min(1).max(10),
  targetLocale: z.enum(TARGET_LOCALES),
})

type Values = z.infer<typeof schema>

interface ProjectSettingsFormProps {
  project: {
    id: string
    name: string
    targetUrl: string
    description: string | null
    authKind: 'none' | 'form'
    crawlMaxDepth: number
    targetLocale: string
  }
}

export function ProjectSettingsForm({ project }: ProjectSettingsFormProps) {
  const t = useTranslations('projects.settings')
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  const initialLocale: TargetLocale = (
    TARGET_LOCALES as readonly string[]
  ).includes(project.targetLocale)
    ? (project.targetLocale as TargetLocale)
    : 'pt-BR'

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: project.name,
      targetUrl: project.targetUrl,
      description: project.description ?? '',
      crawlMaxDepth: project.crawlMaxDepth ?? 3,
      targetLocale: initialLocale,
    },
  })

  const onSubmit = async (values: Values) => {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({
          name: values.name,
          targetUrl: values.targetUrl,
          description: values.description || undefined,
          crawlMaxDepth: values.crawlMaxDepth,
          targetLocale: values.targetLocale,
        }),
      })
      if (!res.ok) {
        toast.error(t('errors.update'))
        return
      }
      toast.success(t('saved'))
      form.reset(values)
      router.refresh()
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setSubmitting(false)
    }
  }

  const doDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'fetch' },
      })
      if (!res.ok) {
        toast.error(t('errors.delete'))
        return
      }
      toast.success(t('deleted'))
      router.replace('/projects')
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.name')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="targetUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.target_url')}</FormLabel>
                <FormControl>
                  <Input {...field} type="url" />
                </FormControl>
                <FormDescription>{t('fields.target_url_hint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.description')}</FormLabel>
                <FormControl>
                  <textarea
                    {...field}
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Separator />

          <section className="space-y-4">
            <div>
              <h2 className="font-display text-base font-semibold">
                {t('crawl.section_title')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('crawl.section_subtitle')}
              </p>
            </div>

            <FormField
              control={form.control}
              name="crawlMaxDepth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('crawl.max_depth_label')}</FormLabel>
                  <Select
                    value={String(field.value ?? 3)}
                    onValueChange={(v) => field.onChange(parseInt(v, 10))}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="1">
                        {t('crawl.depth_options.1')}
                      </SelectItem>
                      <SelectItem value="2">
                        {t('crawl.depth_options.2')}
                      </SelectItem>
                      <SelectItem value="3">
                        {t('crawl.depth_options.3')}
                      </SelectItem>
                      <SelectItem value="4">
                        {t('crawl.depth_options.4')}
                      </SelectItem>
                      <SelectItem value="5">
                        {t('crawl.depth_options.5')}
                      </SelectItem>
                      <SelectItem value="7">
                        {t('crawl.depth_options.7')}
                      </SelectItem>
                      <SelectItem value="10">
                        {t('crawl.depth_options.10')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t('crawl.max_depth_hint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          <Separator />

          <section className="space-y-4">
            <div>
              <h2 className="font-display text-base font-semibold">
                {t('ai.section_title')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('ai.section_subtitle')}
              </p>
            </div>

            <FormField
              control={form.control}
              name="targetLocale"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('ai.target_locale_label')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TARGET_LOCALES.map((loc) => (
                        <SelectItem key={loc} value={loc}>
                          {t(`ai.target_locale_options.${loc}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t('ai.target_locale_hint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          <div className="flex items-center gap-3 border-t border-border pt-5">
            <Button type="submit" disabled={submitting || !form.formState.isDirty}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('save')}
            </Button>
            {form.formState.isDirty ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => form.reset()}
                disabled={submitting}
              >
                {t('discard')}
              </Button>
            ) : null}
          </div>
        </form>
      </Form>

      <Separator />

      <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <h2 className="font-display text-base font-semibold text-destructive">
          {t('danger.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('danger.description')}
        </p>
        <div className="mt-4">
          <Button
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={deleting}
          >
            {t('danger.button')}
          </Button>
        </div>
      </section>

      <Dialog
        open={deleteOpen}
        onOpenChange={(v) => {
          setDeleteOpen(v)
          if (!v) setDeleteConfirm('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('danger.confirm_title')}</DialogTitle>
            <DialogDescription>
              {t('danger.confirm_description', { name: project.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="delete-confirm" className="text-sm font-medium">
              {t('danger.type_name', { name: project.name })}
            </label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={project.name}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              {t('danger.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm !== project.name || deleting}
              onClick={doDelete}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('danger.button')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
