import { createDecipheriv } from 'node:crypto'

/**
 * Decifra credenciais gravadas com AES-256-GCM pelo app (mesma chave
 * AUTH_MFA_ENCRYPTION_KEY do TOTP). Layout: [12 bytes IV][16 bytes tag][ciphertext].
 * Copiado do app/lib/auth/totp.ts pra não depender do bundle do Next.
 */
export function decryptSecret(payload: Buffer): string {
  const raw = process.env.AUTH_MFA_ENCRYPTION_KEY
  if (!raw) throw new Error('AUTH_MFA_ENCRYPTION_KEY não configurada')
  const b64 = raw.startsWith('base64:') ? raw.slice(7) : raw
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error('AUTH_MFA_ENCRYPTION_KEY deve decodificar para 32 bytes')
  }
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const enc = payload.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}
