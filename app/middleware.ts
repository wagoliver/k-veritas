import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'

import { routing } from '@/lib/i18n/routing'
import { verifyAccessToken } from '@/lib/auth/jwt'
import { ACCESS_COOKIE } from '@/lib/auth/cookies'

const intlMiddleware = createIntlMiddleware(routing)

const PUBLIC_AUTH_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/mfa/verify',
]

function withoutLocale(pathname: string): string {
  for (const locale of routing.locales) {
    const prefix = `/${locale}`
    if (pathname === prefix) return '/'
    if (pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length)
    }
  }
  return pathname
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // API routes: não passa por i18n, mas adiciona headers de segurança
  if (pathname.startsWith('/api')) {
    const res = NextResponse.next()
    res.headers.set(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    )
    return res
  }

  const res = intlMiddleware(req)

  const bare = withoutLocale(pathname)
  const isAuthRoute = PUBLIC_AUTH_PATHS.some(
    (p) => bare === p || bare.startsWith(`${p}/`),
  )
  const isRoot = bare === '/'

  const accessToken = req.cookies.get(ACCESS_COOKIE)?.value
  const claims = accessToken ? await verifyAccessToken(accessToken) : null
  const isAuthenticated = claims !== null && claims.mfaLevel !== 'none'
  // "Sessão em trânsito" = logou, falta MFA
  const pendingMfa = claims !== null && claims.mfaLevel === 'none'

  if (isRoot) {
    const url = req.nextUrl.clone()
    url.pathname = isAuthenticated
      ? `/${routing.defaultLocale}/projects`
      : `/${routing.defaultLocale}/login`
    return NextResponse.redirect(url)
  }

  // Legacy redirect: /[locale]/dashboard → /[locale]/projects
  if (bare === '/dashboard' || bare.startsWith('/dashboard/')) {
    const locale = pathname.split('/')[1] ?? routing.defaultLocale
    const url = req.nextUrl.clone()
    url.pathname = `/${locale}/projects`
    return NextResponse.redirect(url)
  }

  if (!isAuthRoute && !isAuthenticated) {
    const locale = pathname.split('/')[1] ?? routing.defaultLocale
    const url = req.nextUrl.clone()
    url.pathname = `/${locale}/login`
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (isAuthenticated && isAuthRoute) {
    const locale = pathname.split('/')[1] ?? routing.defaultLocale
    const url = req.nextUrl.clone()
    url.pathname = `/${locale}/projects`
    url.searchParams.delete('next')
    return NextResponse.redirect(url)
  }

  if (pendingMfa && !bare.startsWith('/mfa')) {
    const locale = pathname.split('/')[1] ?? routing.defaultLocale
    const url = req.nextUrl.clone()
    url.pathname = `/${locale}/mfa/verify`
    return NextResponse.redirect(url)
  }

  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  )
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  return res
}

export const config = {
  matcher: [
    '/((?!_next|favicon.ico|icon.svg|apple-icon.png|icon-.*\\.png).*)',
  ],
}
