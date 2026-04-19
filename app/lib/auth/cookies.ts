import 'server-only'
import type { ResponseCookies } from 'next/dist/compiled/@edge-runtime/cookies'
import type { cookies as nextCookies } from 'next/headers'

export const REFRESH_COOKIE = 'kv_rt'
export const ACCESS_COOKIE = 'kv_at'

type CookieStore =
  | Awaited<ReturnType<typeof nextCookies>>
  | ResponseCookies

function secure(): boolean {
  return process.env.AUTH_COOKIE_SECURE === 'true'
}

function refreshMaxAge(): number {
  const v = Number(process.env.AUTH_REFRESH_TTL_SECONDS ?? 2_592_000)
  return Number.isFinite(v) && v > 0 ? v : 2_592_000
}

function accessMaxAge(): number {
  const v = Number(process.env.AUTH_ACCESS_TTL_SECONDS ?? 600)
  return Number.isFinite(v) && v > 0 ? v : 600
}

export function setRefreshCookie(store: CookieStore, token: string): void {
  store.set({
    name: REFRESH_COOKIE,
    value: token,
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: refreshMaxAge(),
  })
}

export function setAccessCookie(store: CookieStore, token: string): void {
  store.set({
    name: ACCESS_COOKIE,
    value: token,
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: accessMaxAge(),
  })
}

export function clearAuthCookies(store: CookieStore): void {
  store.set({ name: REFRESH_COOKIE, value: '', path: '/', maxAge: 0 })
  store.set({ name: ACCESS_COOKIE, value: '', path: '/', maxAge: 0 })
}
