import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { sessions } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'

export const runtime = 'nodejs'

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const { id } = await ctx.params
  if (!id) return Problems.invalidBody()

  const result = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, id), eq(sessions.userId, session.user.id)))
    .returning({ id: sessions.id })

  if (result.length === 0) return Problems.forbidden()

  await audit({
    userId: session.user.id,
    event: 'session_revoked',
    email: session.user.email,
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { revokedSessionId: id, selfRevoked: id === session.sessionId },
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
