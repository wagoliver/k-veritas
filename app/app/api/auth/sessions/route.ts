import { NextResponse } from 'next/server'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { sessions } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const rows = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ipInet: sessions.ipInet,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      mfaLevel: sessions.mfaLevel,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, session.user.id),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(sessions.createdAt))
    .limit(50)

  return NextResponse.json({
    current: session.sessionId,
    items: rows.map((r) => ({
      id: r.id,
      userAgent: r.userAgent,
      ip: r.ipInet,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      mfaLevel: r.mfaLevel,
      isCurrent: r.id === session.sessionId,
    })),
  })
}
