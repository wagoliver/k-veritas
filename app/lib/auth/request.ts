import 'server-only'
import type { NextRequest } from 'next/server'

export function clientIp(req: NextRequest | Request): string {
  const h = req.headers
  const xff = h.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = h.get('x-real-ip')
  if (real) return real
  return '127.0.0.1'
}

export function userAgent(req: NextRequest | Request): string {
  return req.headers.get('user-agent') ?? 'unknown'
}

/**
 * Pequeno jitter para dificultar timing attacks e enumeração.
 * Dorme entre `min` e `max` milissegundos.
 */
export async function timingJitter(
  min: number = 80,
  max: number = 240,
): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min
  await new Promise<void>((resolve) => setTimeout(resolve, delay))
}
