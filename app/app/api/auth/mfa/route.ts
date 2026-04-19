import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db/pg'
import { mfaFactors, users } from '@/lib/db/schema'
import { verifyPassword } from '@/lib/auth/hash'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'

export const runtime = 'nodejs'

const schema = z.object({ password: z.string().min(1).max(256) })

export async function GET() {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const [factor] = await db
    .select({
      id: mfaFactors.id,
      confirmedAt: mfaFactors.confirmedAt,
      createdAt: mfaFactors.createdAt,
    })
    .from(mfaFactors)
    .where(
      and(
        eq(mfaFactors.userId, session.user.id),
        eq(mfaFactors.type, 'totp'),
      ),
    )
    .limit(1)

  return NextResponse.json({
    enabled: Boolean(factor?.confirmedAt),
    factor: factor
      ? {
          id: factor.id,
          confirmedAt: factor.confirmedAt,
          createdAt: factor.createdAt,
        }
      : null,
  })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const [user] = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)
  if (!user) return Problems.unauthorized()

  const ok = await verifyPassword(user.passwordHash, parsed.data.password)
  if (!ok) {
    await audit({
      userId: user.id,
      event: 'mfa_disable_fail',
      email: user.email,
      ip: clientIp(req),
      userAgent: userAgent(req),
      outcome: 'failure',
    })
    return Problems.invalidCredentials()
  }

  await db
    .delete(mfaFactors)
    .where(
      and(
        eq(mfaFactors.userId, user.id),
        eq(mfaFactors.type, 'totp'),
      ),
    )

  await audit({
    userId: user.id,
    event: 'mfa_disabled',
    email: user.email,
    ip: clientIp(req),
    userAgent: userAgent(req),
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
