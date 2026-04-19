import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db/pg'
import { mfaChallenges, mfaFactors } from '@/lib/db/schema'
import { Problems } from '@/lib/auth/errors'
import { getServerSession } from '@/lib/auth/session'
import {
  createSession,
  writeSessionCookies,
} from '@/lib/auth/session'
import { decryptSecret, verifyTotp } from '@/lib/auth/totp'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'

export const runtime = 'nodejs'

const schema = z.object({
  code: z.string().regex(/^\d{6}$/),
})

export async function POST(req: NextRequest) {
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (session.mfaLevel === 'mfa') {
    return NextResponse.json({ accessToken: 'already' })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const [challenge] = await db
    .select()
    .from(mfaChallenges)
    .where(
      and(
        eq(mfaChallenges.userId, session.user.id),
        isNull(mfaChallenges.consumedAt),
        gt(mfaChallenges.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(mfaChallenges.createdAt))
    .limit(1)

  if (!challenge) {
    await audit({
      userId: session.user.id,
      event: 'mfa_verify_no_challenge',
      ip: clientIp(req),
      userAgent: userAgent(req),
      outcome: 'blocked',
    })
    return Problems.unauthorized()
  }

  const rl = await consumeToken(BUCKETS.mfaChallenge(challenge.id))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  const [factor] = await db
    .select()
    .from(mfaFactors)
    .where(
      and(
        eq(mfaFactors.userId, session.user.id),
        eq(mfaFactors.type, 'totp'),
      ),
    )
    .limit(1)
  if (!factor) return Problems.unauthorized()

  const secret = decryptSecret(factor.secretEncrypted)
  if (!verifyTotp(secret, parsed.data.code)) {
    await db
      .update(mfaChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(mfaChallenges.id, challenge.id))

    await audit({
      userId: session.user.id,
      event: 'mfa_verify_fail',
      email: session.user.email,
      ip: clientIp(req),
      userAgent: userAgent(req),
      outcome: 'failure',
    })
    return Problems.invalidCredentials()
  }

  await db
    .update(mfaChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(mfaChallenges.id, challenge.id))

  // Promove a sessão para mfaLevel = 'mfa'
  const { accessToken, refreshToken } = await createSession({
    userId: session.user.id,
    userAgent: userAgent(req),
    ip: clientIp(req),
    mfaLevel: 'mfa',
    locale: session.user.locale,
  })
  await writeSessionCookies(accessToken, refreshToken)

  await audit({
    userId: session.user.id,
    event: 'mfa_verify_success',
    email: session.user.email,
    ip: clientIp(req),
    userAgent: userAgent(req),
    outcome: 'success',
  })

  return NextResponse.json({ accessToken })
}
