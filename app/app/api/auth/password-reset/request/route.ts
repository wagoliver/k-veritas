import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db/pg'
import { passwordResetTokens, users } from '@/lib/db/schema'
import { BUCKETS, consumeToken } from '@/lib/auth/rate-limit'
import { Problems } from '@/lib/auth/errors'
import { clientIp, timingJitter, userAgent } from '@/lib/auth/request'
import { audit } from '@/lib/auth/audit'
import { generateOpaqueToken } from '@/lib/auth/tokens'
import { getMailer } from '@/lib/mail'

export const runtime = 'nodejs'

const schema = z.object({
  email: z.string().email().max(320),
})

const TTL_MINUTES = 30

export async function POST(req: NextRequest) {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return Problems.invalidBody()
  }
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  await timingJitter(120, 320)

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  const email = parsed.data.email.trim().toLowerCase()
  const ip = clientIp(req)
  const ua = userAgent(req)

  const rl = await consumeToken(BUCKETS.resetEmail(email))
  if (!rl.allowed) {
    // Mesma resposta 204 para não vazar rate-limit vs not-found
    return new NextResponse(null, { status: 204 })
  }

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (user) {
    const { token, hash } = generateOpaqueToken()
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000)

    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt,
    })

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const link = `${appUrl}/pt-BR/reset-password?token=${token}`

    await getMailer().send({
      to: email,
      subject: 'k-veritas — redefinir senha',
      text: `Use o link abaixo para redefinir sua senha. Ele expira em ${TTL_MINUTES} minutos.\n\n${link}\n\nSe você não solicitou isso, ignore este email.`,
    })

    await audit({
      userId: user.id,
      event: 'password_reset_requested',
      email,
      ip,
      userAgent: ua,
      outcome: 'success',
    })
  } else {
    await audit({
      event: 'password_reset_unknown_email',
      email,
      ip,
      userAgent: ua,
      outcome: 'failure',
    })
  }

  return new NextResponse(null, { status: 204 })
}
