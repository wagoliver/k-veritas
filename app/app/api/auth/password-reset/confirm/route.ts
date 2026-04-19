import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db/pg'
import { passwordResetTokens, users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/hash'
import { passwordSchema } from '@/lib/auth/password-policy'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'
import { hashToken } from '@/lib/auth/tokens'
import { revokeAllUserSessions } from '@/lib/auth/session'

export const runtime = 'nodejs'

const schema = z.object({
  token: z.string().min(10).max(128),
  newPassword: passwordSchema,
})

export async function POST(req: NextRequest) {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const ip = clientIp(req)
  const ua = userAgent(req)
  const hash = hashToken(parsed.data.token)

  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1)

  if (!row) {
    await audit({
      event: 'password_reset_invalid_token',
      ip,
      userAgent: ua,
      outcome: 'failure',
    })
    return Problems.unauthorized()
  }

  const newHash = await hashPassword(parsed.data.newPassword)

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash: newHash,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, row.userId))

    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id))
  })

  await revokeAllUserSessions(row.userId)

  await audit({
    userId: row.userId,
    event: 'password_reset_success',
    ip,
    userAgent: ua,
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
