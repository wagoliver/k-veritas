'use client'

import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import { passwordStrength } from '@/lib/auth/password-policy'

const TONE = [
  'bg-destructive/70',
  'bg-destructive',
  'bg-amber-500',
  'bg-fin-gain/80',
  'bg-fin-gain',
] as const

export function PasswordStrength({ value }: { value: string }) {
  const t = useTranslations('auth.password_strength')
  const score = value.length === 0 ? -1 : passwordStrength(value)
  const labels = [t('very_weak'), t('weak'), t('ok'), t('good'), t('strong')]

  return (
    <div
      className="mt-2"
      aria-live="polite"
      aria-label={score >= 0 ? labels[score] : undefined}
    >
      <div className="grid grid-cols-5 gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1 rounded-full transition-colors',
              score >= i ? TONE[Math.max(0, score)] : 'bg-border',
            )}
          />
        ))}
      </div>
      {score >= 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {labels[score]}
        </p>
      ) : null}
    </div>
  )
}
