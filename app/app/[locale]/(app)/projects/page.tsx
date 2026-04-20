import type { Metadata } from 'next'
import { desc, eq, sql } from 'drizzle-orm'
import { FolderPlus, Plus } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import { DateTime } from '@/components/ui/date-time'
import { db } from '@/lib/db/pg'
import { crawlJobs, orgMembers, projects } from '@/lib/db/schema'
import { Link } from '@/lib/i18n/navigation'
import { getServerSession } from '@/lib/auth/session'
import { ProjectStatusBadge } from '@/components/projects/status-badge'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'projects' })
  return { title: t('title') }
}

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('projects')

  const session = await getServerSession()
  if (!session) return null

  const items = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      targetUrl: projects.targetUrl,
      status: projects.status,
      updatedAt: projects.updatedAt,
      pagesCount: sql<number>`(
        SELECT COALESCE(MAX(${crawlJobs.pagesCount}), 0)
        FROM ${crawlJobs}
        WHERE ${crawlJobs.projectId} = ${projects.id}
          AND ${crawlJobs.status} = 'completed'
      )`,
    })
    .from(projects)
    .innerJoin(orgMembers, eq(orgMembers.orgId, projects.orgId))
    .where(eq(orgMembers.userId, session.user.id))
    .orderBy(desc(projects.updatedAt))

  if (items.length === 0) {
    return (
      <main className="flex flex-1 flex-col p-6 lg:p-10">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </header>
        <section className="flex flex-1 items-center justify-center">
          <div className="surface-card glow-teal-sm flex max-w-md flex-col items-center gap-4 rounded-xl px-8 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FolderPlus className="size-6" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold">
                {t('empty.title')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('empty.description')}
              </p>
            </div>
            <Button asChild className="mt-2">
              <Link href="/projects/new">
                <Plus className="size-4" />
                {t('empty.cta')}
              </Link>
            </Button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col p-6 lg:p-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/projects/new">
            <Plus className="size-4" />
            {t('actions.new')}
          </Link>
        </Button>
      </header>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">
                {t('table.name')}
              </th>
              <th className="px-4 py-2.5 text-left font-medium">
                {t('table.target_url')}
              </th>
              <th className="px-4 py-2.5 text-left font-medium">
                {t('table.status')}
              </th>
              <th className="px-4 py-2.5 text-right font-medium">
                {t('table.pages')}
              </th>
              <th className="px-4 py-2.5 text-right font-medium">
                {t('table.updated')}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr
                key={p.id}
                className="border-b border-border/60 last:border-0 transition-colors hover:bg-accent/40"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-medium hover:underline underline-offset-4"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {p.targetUrl ? shortUrl(p.targetUrl) : (
                    <span className="opacity-60">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <ProjectStatusBadge status={p.status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {p.pagesCount ?? 0}
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                  <DateTime
                    value={p.updatedAt as unknown as string}
                    dateStyle="medium"
                    timeStyle="short"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}

function shortUrl(raw: string | null): string {
  if (!raw) return ''
  try {
    const u = new URL(raw)
    return `${u.hostname}${u.pathname !== '/' ? u.pathname : ''}`
  } catch {
    return raw
  }
}
