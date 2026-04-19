import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db/pg'
import { sessions, users } from '@/lib/db/schema'
import { hashPassword, verifyPassword } from '@/lib/auth/hash'
import { passwordSchema } from '@/lib/auth/password-policy'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'

export const runtime = 'nodejs'

const schema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
})

export async function POST(req: NextRequest) {
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

  const ok = await verifyPassword(user.passwordHash, parsed.data.currentPassword)
  if (!ok) {
    await audit({
      userId: user.id,
      event: 'password_change_fail',
      email: user.email,
      ip: clientIp(req),
      userAgent: userAgent(req),
      outcome: 'failure',
    })
    return Problems.invalidCredentials()
  }

  const newHash = await hashPassword(parsed.data.newPassword)

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, user.id))

    // Revoga todas as outras sessões; mantém a atual
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, user.id),
          isNull(sessions.revokedAt),
          ne(sessions.id, session.sessionId),
        ),
      )
  })

  await audit({
    userId: user.id,
    event: 'password_change_success',
    email: user.email,
    ip: clientIp(req),
    userAgent: userAgent(req),
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
