'use client'

import { useTranslations } from 'next-intl'

export function Footer() {
  const t = useTranslations('shell.footer')
  return (
    <footer className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <span>k-veritas · v0.0.1</span>
      <nav className="flex items-center gap-4">
        <span className="opacity-60">{t('docs')}</span>
        <span className="opacity-60">{t('terms')}</span>
      </nav>
    </footer>
  )
}
