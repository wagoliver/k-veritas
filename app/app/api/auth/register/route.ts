import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db/pg'
import { users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/hash'
import { passwordSchema } from '@/lib/auth/password-policy'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'
import { Problems } from '@/lib/auth/errors'
import { clientIp, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'
import { isLocale, DEFAULT_LOCALE } from '@/lib/i18n/config'

export const runtime = 'nodejs'

const schema = z.object({
  email: z.string().email().max(320),
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(80),
  locale: z.string().optional(),
})

function assertHeaders(req: NextRequest): Response | null {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }
  return null
}

export async function POST(req: NextRequest) {
  const guard = assertHeaders(req)
  if (guard) return guard

  const ip = clientIp(req)
  const ua = userAgent(req)

  const rl = await consumeToken(BUCKETS.registerIp(ip))
  if (!rl.allowed) return Problems.rateLimited(rl.retryAfterSeconds)

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return Problems.invalidBody()
  }

  const email = parsed.data.email.trim().toLowerCase()
  const locale = parsed.data.locale && isLocale(parsed.data.locale)
    ? parsed.data.locale
    : DEFAULT_LOCALE

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (existing) {
    await audit({
      event: 'register_conflict',
      email,
      ip,
      userAgent: ua,
      outcome: 'failure',
    })
    return Problems.conflict('email_taken')
  }

  const passwordHash = await hashPassword(parsed.data.password)

  const [created] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      displayName: parsed.data.displayName,
      locale,
    })
    .returning({ id: users.id })

  if (!created) return Problems.server()

  await audit({
    userId: created.id,
    event: 'register_success',
    email,
    ip,
    userAgent: ua,
    outcome: 'success',
  })

  return NextResponse.json(
    {
      user: {
        id: created.id,
        email,
        displayName: parsed.data.displayName,
        locale,
      },
      requiresEmailVerification: true,
    },
    { status: 201 },
  )
}
