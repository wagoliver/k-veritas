import { setRequestLocale } from 'next-intl/server'

import { LocaleSwitcher } from '@/components/auth/locale-switcher'
import { Logo } from '@/components/auth/logo'

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[520px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl opacity-40"
          style={{
            background:
              'radial-gradient(closest-side, oklch(0.78 0.16 182 / 0.22), transparent 70%)',
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md animate-fade-up">
        <header className="mb-6 flex items-center justify-between">
          <Logo className="h-7 w-auto text-foreground" />
          <LocaleSwitcher />
        </header>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          k-veritas · v0.0.1
        </p>
      </div>
    </main>
  )
}
