import 'server-only'
import { cookies } from 'next/headers'
import { and, eq, isNull, gt, sql } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { sessions, users, type User } from '@/lib/db/schema'
import { signAccessToken, verifyAccessToken, type MfaLevel } from './jwt'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  setAccessCookie,
  setRefreshCookie,
} from './cookies'
import { generateOpaqueToken, hashToken } from './tokens'

export interface SessionContext {
  user: User
  sessionId: string
  mfaLevel: MfaLevel
}

function refreshTtl(): number {
  const v = Number(process.env.AUTH_REFRESH_TTL_SECONDS ?? 2_592_000)
  return Number.isFinite(v) && v > 0 ? v : 2_592_000
}

export interface CreateSessionInput {
  userId: string
  userAgent: string
  ip: string
  mfaLevel: MfaLevel
  locale: string
}

export async function createSession(input: CreateSessionInput): Promise<{
  accessToken: string
  refreshToken: string
  sessionId: string
}> {
  const { token: refreshToken, hash: refreshHash } = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + refreshTtl() * 1000)

  const [row] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      refreshHash,
      userAgent: input.userAgent.slice(0, 512),
      ipInet: input.ip,
      expiresAt,
      mfaLevel: input.mfaLevel,
    })
    .returning({ id: sessions.id })

  if (!row) throw new Error('falha ao criar sessão')

  const accessToken = await signAccessToken({
    sub: input.userId,
    sid: row.id,
    locale: input.locale,
    mfaLevel: input.mfaLevel,
  })

  return { accessToken, refreshToken, sessionId: row.id }
}

export async function writeSessionCookies(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const store = await cookies()
  setAccessCookie(store, accessToken)
  setRefreshCookie(store, refreshToken)
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies()
  clearAuthCookies(store)
}

/**
 * Rotação: valida um refresh token, emite novos tokens, revoga o anterior
 * e encadeia via replaced_by. Reuso de refresh já rotacionado invalida
 * toda a cadeia (detecção de replay).
 */
export async function rotateRefresh(opts: {
  refreshToken: string
  userAgent: string
  ip: string
}): Promise<
  | {
      status: 'ok'
      accessToken: string
      refreshToken: string
      sessionId: string
      user: User
    }
  | { status: 'invalid' }
  | { status: 'replayed'; userId: string }
> {
  const hash = hashToken(opts.refreshToken)

  const [existing] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshHash, hash))
    .limit(1)

  if (!existing) return { status: 'invalid' }

  if (existing.revokedAt) {
    // Token já rotacionado e revogado — possível replay. Revoga toda a cadeia.
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.userId, existing.userId), isNull(sessions.revokedAt)),
      )
    return { status: 'replayed', userId: existing.userId }
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    return { status: 'invalid' }
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, existing.userId))
    .limit(1)
  if (!user || user.status !== 'active') return { status: 'invalid' }

  const { token: newRefresh, hash: newHash } = generateOpaqueToken()
  const newExpires = new Date(Date.now() + refreshTtl() * 1000)

  const [next] = await db
    .insert(sessions)
    .values({
      userId: existing.userId,
      refreshHash: newHash,
      userAgent: opts.userAgent.slice(0, 512),
      ipInet: opts.ip,
      expiresAt: newExpires,
      mfaLevel: existing.mfaLevel,
    })
    .returning({ id: sessions.id })

  if (!next) return { status: 'invalid' }

  await db
    .update(sessions)
    .set({ revokedAt: new Date(), replacedBy: next.id })
    .where(eq(sessions.id, existing.id))

  const accessToken = await signAccessToken({
    sub: user.id,
    sid: next.id,
    locale: user.locale,
    mfaLevel: existing.mfaLevel as MfaLevel,
  })

  return {
    status: 'ok',
    accessToken,
    refreshToken: newRefresh,
    sessionId: next.id,
    user,
  }
}

export async function revokeSessionByRefresh(refreshToken: string): Promise<void> {
  const hash = hashToken(refreshToken)
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.refreshHash, hash), isNull(sessions.revokedAt)))
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
}

/**
 * Lê sessão do cookie de access token. Para uso em Server Components e
 * rotas /api que já passaram pelo middleware.
 */
export async function getServerSession(): Promise<SessionContext | null> {
  const store = await cookies()
  const raw = store.get(ACCESS_COOKIE)?.value
  if (!raw) return null
  const claims = await verifyAccessToken(raw)
  if (!claims) return null

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1)
  if (!user || user.status !== 'active') return null

  const [active] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, claims.sid),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1)

  if (!active) return null

  return {
    user,
    sessionId: claims.sid,
    mfaLevel: claims.mfaLevel,
  }
}

export function getRefreshCookieName(): string {
  return REFRESH_COOKIE
}
