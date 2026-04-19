import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface AuthCardProps {
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}

export function AuthCard({
  title,
  description,
  footer,
  children,
  className,
}: AuthCardProps) {
  return (
    <section
      className={cn(
        'surface-card glow-teal-sm rounded-xl p-6 sm:p-7',
        className,
      )}
    >
      <header className="mb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>

      {children}

      {footer ? (
        <footer className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </section>
  )
}
