import './globals.css'

import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'k-veritas',
    template: '%s · k-veritas',
  },
  description: 'Testes que dizem a verdade — Playwright + LLM para QA.',
  applicationName: 'k-veritas',
  referrer: 'strict-origin-when-cross-origin',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#101013',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Locale é definido pelo layout [locale] — aqui só lang padrão.
  return (
    <html lang="pt-BR" className="dark">
      <body className="font-sans antialiased grain min-h-screen">
        {children}
      </body>
    </html>
  )
}
