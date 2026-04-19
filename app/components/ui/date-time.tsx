'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'

/**
 * Renderiza uma data em ISO/UTC no timezone do navegador.
 *
 * Padrão: durante o SSR mostra um placeholder estável (ISO sem hora ou o
 * `fallback` explícito); após hydration no cliente renderiza formatado com
 * `Intl.DateTimeFormat` usando a tz local automaticamente.
 *
 * Isso mantém o servidor agnóstico de timezone (toda data volta em UTC do
 * Postgres) e evita warnings de hydration mismatch: o primeiro render no
 * cliente é idêntico ao SSR, e o segundo (pós-useEffect) substitui pelo
 * valor localizado.
 */
export interface DateTimeProps {
  value: string | Date
  dateStyle?: 'full' | 'long' | 'medium' | 'short'
  timeStyle?: 'full' | 'long' | 'medium' | 'short'
  fallback?: string
  className?: string
}

export function DateTime({
  value,
  dateStyle = 'short',
  timeStyle = 'short',
  fallback,
  className,
}: DateTimeProps) {
  const locale = useLocale()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const date = typeof value === 'string' ? new Date(value) : value
  const iso = date.toISOString()

  if (!mounted) {
    return (
      <time dateTime={iso} className={className} suppressHydrationWarning>
        {fallback ?? '—'}
      </time>
    )
  }

  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle,
    timeStyle,
  }).format(date)

  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {formatted}
    </time>
  )
}
