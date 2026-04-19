'use client'

import { Brain, ShieldCheck, User as UserIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link, usePathname } from '@/lib/i18n/navigation'
import { cn } from '@/lib/utils'

export function SettingsNav() {
  const t = useTranslations('settings.nav')
  const pathname = usePathname()

  const items = [
    { href: '/settings/profile', label: t('profile'), icon: UserIcon },
    { href: '/settings/security', label: t('security'), icon: ShieldCheck },
    { href: '/settings/ai', label: t('ai'), icon: Brain },
  ]

  return (
    <nav aria-label={t('label')} className="flex lg:flex-col">
      <ul className="flex w-full gap-1 lg:flex-col">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon
          return (
            <li key={item.href} className="flex-1 lg:flex-initial">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
