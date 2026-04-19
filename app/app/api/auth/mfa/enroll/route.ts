import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db/pg'
import { mfaFactors } from '@/lib/db/schema'
import { getServerSession } from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import {
  encryptSecret,
  generateSecret,
  otpauthUri,
  qrSvgFor,
  verifyTotp,
} from '@/lib/auth/totp'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'

export const runtime = 'nodejs'

/**
 * GET  → gera segredo provisório e devolve QR + otpauth URI.
 *        O segredo fica na resposta; cliente envia código + secret no POST.
 *        (Não persistimos até confirmação para evitar lixo.)
 * POST → recebe { secret, code }, valida e persiste como fator confirmado.
 */
export async function GET() {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()

  const [existing] = await db
    .select({ id: mfaFactors.id, confirmedAt: mfaFactors.confirmedAt })
    .from(mfaFactors)
    .where(
      and(eq(mfaFactors.userId, session.user.id), eq(mfaFactors.type, 'totp')),
    )
    .limit(1)

  if (existing?.confirmedAt) {
    return Problems.conflict('mfa_already_enrolled')
  }

  const secret = generateSecret()
  const uri = otpauthUri(secret, session.user.email)
  const qrSvg = await qrSvgFor(uri)

  return NextResponse.json({ secret, otpauthUri: uri, qrSvg })
}

const confirmSchema = z.object({
  secret: z
    .string()
    .regex(/^[A-Z2-7]+=*$/, { message: 'invalid_secret' })
    .min(16)
    .max(64),
  code: z.string().regex(/^\d{6}$/),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return Problems.unauthorized()
  if (req.headers.get('x-requested-with') !== 'fetch') {
    return Problems.invalidBody()
  }

  const body = await req.json().catch(() => null)
  const parsed = confirmSchema.safeParse(body)
  if (!parsed.success) return Problems.invalidBody()

  if (!verifyTotp(parsed.data.secret, parsed.data.code)) {
    await audit({
      userId: session.user.id,
      event: 'mfa_enroll_fail',
      ip: clientIp(req),
      userAgent: userAgent(req),
      outcome: 'failure',
    })
    return Problems.invalidCredentials()
  }

  const encrypted = encryptSecret(parsed.data.secret)

  // Garante apenas um fator TOTP ativo por usuário
  await db
    .delete(mfaFactors)
    .where(
      and(
        eq(mfaFactors.userId, session.user.id),
        eq(mfaFactors.type, 'totp'),
      ),
    )

  await db.insert(mfaFactors).values({
    userId: session.user.id,
    type: 'totp',
    secretEncrypted: encrypted,
    confirmedAt: new Date(),
  })

  await audit({
    userId: session.user.id,
    event: 'mfa_enroll_success',
    ip: clientIp(req),
    userAgent: userAgent(req),
    outcome: 'success',
  })

  return new NextResponse(null, { status: 204 })
}
