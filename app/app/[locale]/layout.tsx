import { notFound } from 'next/navigation'
import { DM_Sans, JetBrains_Mono, Outfit } from 'next/font/google'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'

import { Toaster } from '@/components/ui/sonner'
import { routing } from '@/lib/i18n/routing'

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
})
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jetbrains',
  display: 'swap',
})
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
})

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }
  setRequestLocale(locale)

  return (
    <div
      lang={locale}
      className={`${dmSans.variable} ${jetbrains.variable} ${outfit.variable}`}
    >
      <NextIntlClientProvider locale={locale}>
        {children}
        <Toaster richColors position="top-right" />
      </NextIntlClientProvider>
    </div>
  )
}
