import { NextResponse, type NextRequest } from 'next/server'

import {
  clearSessionCookies,
  getRefreshCookieName,
  revokeSessionByRefresh,
} from '@/lib/auth/session'
import { audit } from '@/lib/auth/audit'
import { clientIp, userAgent } from '@/lib/auth/request'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const refresh = req.cookies.get(getRefreshCookieName())?.value
  if (refresh) {
    await revokeSessionByRefresh(refresh)
  }
  await clearSessionCookies()
  await audit({
    event: 'logout',
    ip: clientIp(req),
    userAgent: userAgent(req),
    outcome: 'success',
  })
  return new NextResponse(null, { status: 204 })
}
