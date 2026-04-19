'use client'

import { useLocale } from 'next-intl'
import { useTransition } from 'react'

import { usePathname, useRouter } from '@/lib/i18n/navigation'
import { LOCALES, type Locale } from '@/lib/i18n/config'
import { cn } from '@/lib/utils'

const LABELS: Record<Locale, string> = {
  'pt-BR': 'PT',
  'en-US': 'EN',
}

export function LocaleSwitcher() {
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  const switchTo = (target: Locale) => {
    if (target === locale) return
    startTransition(() => {
      router.replace(pathname, { locale: target })
    })
  }

  return (
    <div
      role="radiogroup"
      aria-label="Idioma"
      className={cn(
        'inline-flex rounded-md border border-border bg-secondary/50 p-0.5 text-xs font-medium',
        pending && 'opacity-60',
      )}
    >
      {LOCALES.map((l) => {
        const active = l === locale
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => switchTo(l)}
            className={cn(
              'rounded-[4px] px-2 py-1 transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {LABELS[l]}
          </button>
        )
      })}
    </div>
  )
}
