import { NextResponse, type NextRequest } from 'next/server'

import {
  clearSessionCookies,
  getRefreshCookieName,
  rotateRefresh,
  writeSessionCookies,
} from '@/lib/auth/session'
import { Problems } from '@/lib/auth/errors'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(getRefreshCookieName())?.value
  if (!cookie) return Problems.unauthorized()

  const ip = clientIp(req)
  const ua = userAgent(req)

  const result = await rotateRefresh({
    refreshToken: cookie,
    userAgent: ua,
    ip,
  })

  if (result.status === 'invalid') {
    await clearSessionCookies()
    return Problems.unauthorized()
  }

  if (result.status === 'replayed') {
    await clearSessionCookies()
    await audit({
      userId: result.userId,
      event: 'refresh_replay_detected',
      ip,
      userAgent: ua,
      outcome: 'blocked',
    })
    return Problems.unauthorized()
  }

  await writeSessionCookies(result.accessToken, result.refreshToken)
  await audit({
    userId: result.user.id,
    event: 'refresh_success',
    email: result.user.email,
    ip,
    userAgent: ua,
    outcome: 'success',
  })
  return NextResponse.json({ accessToken: result.accessToken })
}
