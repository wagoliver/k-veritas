import 'server-only'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

/**
 * Gera um token opaco (32 bytes base64url) e seu hash SHA-256.
 * Usado para refresh tokens e reset tokens.
 */
export function generateOpaqueToken(): { token: string; hash: Buffer } {
  const raw = randomBytes(32)
  const token = raw.toString('base64url')
  const hash = createHash('sha256').update(raw).digest()
  return { token, hash }
}

export function hashToken(token: string): Buffer {
  let raw: Buffer
  try {
    raw = Buffer.from(token, 'base64url')
    if (raw.length !== 32) throw new Error('bad size')
  } catch {
    return createHash('sha256').update('invalid').digest()
  }
  return createHash('sha256').update(raw).digest()
}

export function tokensEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function hashEmail(email: string): string {
  return createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex')
}
