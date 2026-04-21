import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'

import { routing } from '@/lib/i18n/routing'
import { verifyAccessToken } from '@/lib/auth/jwt'
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/cookies'
import { silentRefreshAccess } from '@/lib/auth/session'

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

  // API routes: não passa por i18n, mas ainda tenta silent refresh do
  // access cookie quando expirou. Sem isso, polling em páginas abertas
  // por mais de AUTH_ACCESS_TTL_SECONDS começa a cair em 401 mesmo com
  // o refresh ainda válido. O refresh só dispara quando claims == null,
  // então chamadas com access válido não pagam custo extra.
  if (pathname.startsWith('/api')) {
    const accessToken = req.cookies.get(ACCESS_COOKIE)?.value
    const claims = accessToken ? await verifyAccessToken(accessToken) : null

    let newAccessToken: string | null = null
    if (!claims) {
      const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value
      if (refreshToken) {
        const refreshed = await silentRefreshAccess(refreshToken)
        if (refreshed.status === 'ok') {
          newAccessToken = refreshed.accessToken
        }
      }
    }

    // Se renovou, precisa reescrever o header Cookie do request pra que
    // o route handler (getServerSession) enxergue o token novo. Sem
    // isso, a chamada atual ainda devolve 401 — só a próxima se
    // beneficiaria. Truque: NextResponse.next({ request: { headers }})
    // substitui os headers entregues ao handler.
    let res: NextResponse
    if (newAccessToken) {
      const requestHeaders = new Headers(req.headers)
      const incomingCookie = requestHeaders.get('cookie') ?? ''
      const withoutOld = incomingCookie
        .split(';')
        .map((c) => c.trim())
        .filter((c) => !c.startsWith(`${ACCESS_COOKIE}=`))
      withoutOld.push(`${ACCESS_COOKIE}=${newAccessToken}`)
      requestHeaders.set('cookie', withoutOld.join('; '))
      res = NextResponse.next({ request: { headers: requestHeaders } })
      res.cookies.set({
        name: ACCESS_COOKIE,
        value: newAccessToken,
        httpOnly: true,
        secure: process.env.AUTH_COOKIE_SECURE === 'true',
        sameSite: 'lax',
        path: '/',
        maxAge: Number(process.env.AUTH_ACCESS_TTL_SECONDS ?? 3600),
      })
    } else {
      res = NextResponse.next()
    }
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
  let claims = accessToken ? await verifyAccessToken(accessToken) : null

  // Silent refresh: access expirou mas tem refresh. Emite novo access sem
  // rotacionar refresh (evita race entre abas). Usuário nunca cai no login
  // enquanto estiver ativo — sessão só expira se ficar inativo 30 dias.
  if (!claims) {
    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value
    if (refreshToken) {
      const refreshed = await silentRefreshAccess(refreshToken)
      if (refreshed.status === 'ok') {
        claims = await verifyAccessToken(refreshed.accessToken)
        res.cookies.set({
          name: ACCESS_COOKIE,
          value: refreshed.accessToken,
          httpOnly: true,
          secure: process.env.AUTH_COOKIE_SECURE === 'true',
          sameSite: 'lax',
          path: '/',
          maxAge: Number(process.env.AUTH_ACCESS_TTL_SECONDS ?? 3600),
        })
      }
    }
  }

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
  // Node runtime é necessário pra fazer silent refresh contra o Postgres.
  // Edge runtime não suporta postgres-js.
  runtime: 'nodejs',
  matcher: [
    '/((?!_next|favicon.ico|icon.svg|apple-icon.png|icon-.*\\.png).*)',
  ],
}
