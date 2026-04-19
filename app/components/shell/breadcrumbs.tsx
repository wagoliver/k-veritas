'use client'

import { Fragment } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { usePathname } from '@/lib/i18n/navigation'
import { labelKeyFor } from '@/lib/i18n/breadcrumb-labels'

export function Breadcrumbs() {
  const pathname = usePathname()
  const locale = useLocale()
  const t = useTranslations()

  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 0) return null

  const items = segments.map((segment, idx) => {
    const href = `/${segments.slice(0, idx + 1).join('/')}`
    const key = labelKeyFor(segment)
    const label = key ? t(key) : decodeURIComponent(segment)
    const isLast = idx === segments.length - 1
    return { href, label, isLast }
  })

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, idx) => (
          <Fragment key={item.href}>
            <BreadcrumbItem>
              {item.isLast ? (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={`/${locale}${item.href}`}>
                  {item.label}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {!item.isLast ? <BreadcrumbSeparator /> : null}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
