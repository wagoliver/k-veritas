import { createDecipheriv } from 'node:crypto'

import { requireEnv } from './env.ts'

// Decriptador compartilhado. Mesmo layout AES-256-GCM usado em
// app/lib/auth/totp.ts (encryptSecret) e crawler/src/crypto.ts.
// Layout: [12 bytes IV][16 bytes tag][ciphertext].

function getEncryptionKey(): Buffer {
  const raw = requireEnv('AUTH_MFA_ENCRYPTION_KEY')
  const b64 = raw.startsWith('base64:') ? raw.slice(7) : raw
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error('AUTH_MFA_ENCRYPTION_KEY deve decodificar para 32 bytes')
  }
  return key
}

export function decryptSecret(payload: Buffer): string {
  const key = getEncryptionKey()
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const enc = payload.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}
