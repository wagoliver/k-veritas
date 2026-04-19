'use client'

import { useTheme } from 'next-themes'
import { Check, Laptop, Moon, Sun } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'

const OPTIONS = [
  { value: 'light', icon: Sun, key: 'light' },
  { value: 'dark', icon: Moon, key: 'dark' },
  { value: 'system', icon: Laptop, key: 'system' },
] as const

export function ThemeRadioGroup() {
  const { theme, setTheme } = useTheme()
  const t = useTranslations('shell.theme')
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        {t('label')}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={mounted ? theme : undefined}
        onValueChange={setTheme}
      >
        {OPTIONS.map((opt) => {
          const Icon = opt.icon
          const selected = mounted && theme === opt.value
          return (
            <DropdownMenuRadioItem key={opt.value} value={opt.value}>
              <span className="flex w-full items-center gap-2">
                <Icon className="size-4" />
                <span>{t(opt.key)}</span>
                {selected ? (
                  <Check className="ml-auto size-4 text-primary" />
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          )
        })}
      </DropdownMenuRadioGroup>
    </>
  )
}
