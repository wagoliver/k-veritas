import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db/pg'
import { mfaChallenges, mfaFactors, users } from '@/lib/db/schema'
import { verifyPassword } from '@/lib/auth/hash'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'
import { Problems } from '@/lib/auth/errors'
import { clientIp, timingJitter, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'
import { createSession, writeSessionCookies } from '@/lib/auth/session'

export const runtime = 'nodejs'

const schema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
})

const LOCK_WINDOW_MS = 15 * 60 * 1000
const LOCK_THRESHOLD = 10

function guard(req: NextRequest): Response | null {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }
  return null
}

export async function POST(req: NextRequest) {
  const check = guard(req)
  if (check) return check

  const ip = clientIp(req)
  const ua = userAgent(req)

  await timingJitter()

  const rlIp = await consumeToken(BUCKETS.loginIp(ip))
  if (!rlIp.allowed) return Problems.rateLimited(rlIp.retryAfterSeconds)

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const email = parsed.data.email.trim().toLowerCase()

  const rlEmail = await consumeToken(BUCKETS.loginEmail(email))
  if (!rlEmail.allowed) return Problems.rateLimited(rlEmail.retryAfterSeconds)

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  // Executa hash mesmo sem usuário para não vazar por timing
  const ok = user
    ? await verifyPassword(user.passwordHash, parsed.data.password)
    : await verifyPassword(
        '$argon2id$v=19$m=65536,t=3,p=1$YWFhYWFhYWFhYWFhYWFhYQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        parsed.data.password,
      )

  if (!user || user.status !== 'active' || !ok) {
    if (user) {
      const failed = user.failedLoginCount + 1
      const lockedUntil =
        failed >= LOCK_THRESHOLD
          ? new Date(Date.now() + LOCK_WINDOW_MS)
          : user.lockedUntil
      await db
        .update(users)
        .set({ failedLoginCount: failed, lockedUntil })
        .where(eq(users.id, user.id))
    }

    await audit({
      event: 'login_failure',
      email,
      ip,
      userAgent: ua,
      outcome: 'failure',
      userId: user?.id,
    })
    return Problems.invalidCredentials()
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await audit({
      event: 'login_blocked_lockout',
      userId: user.id,
      email,
      ip,
      userAgent: ua,
      outcome: 'blocked',
    })
    return Problems.invalidCredentials()
  }

  // Reset contador de falhas
  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, user.id))

  // Usuário tem MFA confirmado?
  const [factor] = await db
    .select({ id: mfaFactors.id })
    .from(mfaFactors)
    .where(
      and(
        eq(mfaFactors.userId, user.id),
        eq(mfaFactors.type, 'totp'),
      ),
    )
    .limit(1)

  const hasMfa = factor !== undefined

  const mfaLevel = hasMfa ? 'none' : 'mfa' // sem MFA configurado → já entra autenticado

  const { accessToken, refreshToken } = await createSession({
    userId: user.id,
    userAgent: ua,
    ip,
    mfaLevel,
    locale: user.locale,
  })

  if (hasMfa) {
    // Cria challenge de MFA
    await db
      .update(mfaChallenges)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(mfaChallenges.userId, user.id),
          isNull(mfaChallenges.consumedAt),
        ),
      )
    await db.insert(mfaChallenges).values({
      userId: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ipInet: ip,
      userAgent: ua.slice(0, 512),
    })
  }

  await writeSessionCookies(accessToken, refreshToken)

  await audit({
    userId: user.id,
    event: hasMfa ? 'login_mfa_pending' : 'login_success',
    email,
    ip,
    userAgent: ua,
    outcome: 'success',
  })

  return NextResponse.json({
    accessToken,
    mfaRequired: hasMfa,
  })
}
