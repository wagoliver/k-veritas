import 'server-only'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { TOTP, Secret } from 'otpauth'
import QRCode from 'qrcode'

const ISSUER = 'k-veritas'

function getEncryptionKey(): Buffer {
  const raw = process.env.AUTH_MFA_ENCRYPTION_KEY
  if (!raw) throw new Error('AUTH_MFA_ENCRYPTION_KEY não configurada')
  const b64 = raw.startsWith('base64:') ? raw.slice(7) : raw
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error('AUTH_MFA_ENCRYPTION_KEY deve decodificar para 32 bytes')
  }
  return key
}

/**
 * Cifra o segredo TOTP com AES-256-GCM.
 * Layout: [12 bytes IV][16 bytes tag][ciphertext]
 */
export function encryptSecret(plaintext: string): Buffer {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc])
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

export function generateSecret(): string {
  return new Secret({ size: 20 }).base32
}

export function otpauthUri(secretBase32: string, label: string): string {
  const totp = new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  })
  return totp.toString()
}

export async function qrSvgFor(uri: string): Promise<string> {
  return QRCode.toString(uri, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#0a0a0b', light: '#ffffff' },
  })
}

export function verifyTotp(secretBase32: string, code: string): boolean {
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  })
  const delta = totp.validate({ token: code, window: 1 })
  return delta !== null
}
