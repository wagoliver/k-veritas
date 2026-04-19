import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db/pg'
import { users } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'
import { isLocale } from '@/lib/i18n/config'

export const runtime = 'nodejs'

const schema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  locale: z.string().optional(),
})

export async function GET() {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  return NextResponse.json({
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    locale: session.user.locale,
    emailVerifiedAt: session.user.emailVerifiedAt,
  })
}

export async function PATCH(req: NextRequest) {
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

  const updates: {
    displayName?: string
    locale?: string
    updatedAt: Date
  } = { updatedAt: new Date() }

  if (parsed.data.displayName !== undefined) {
    updates.displayName = parsed.data.displayName
  }
  if (parsed.data.locale !== undefined) {
    if (!isLocale(parsed.data.locale)) return Problems.invalidBody()
    updates.locale = parsed.data.locale
  }

  await db.update(users).set(updates).where(eq(users.id, session.user.id))

  await audit({
    userId: session.user.id,
    event: 'profile_updated',
    email: session.user.email,
    ip: clientIp(req),
    userAgent: userAgent(req),
    meta: { fields: Object.keys(updates).filter((k) => k !== 'updatedAt') },
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
