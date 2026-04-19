import 'server-only'
import { jwtVerify, SignJWT, errors as joseErrors } from 'jose'

export type MfaLevel = 'none' | 'mfa'

export interface AccessTokenClaims {
  sub: string
  sid: string
  locale: string
  mfaLevel: MfaLevel
}

interface InternalClaims extends AccessTokenClaims {
  iat: number
  exp: number
}

function getSecrets(): Uint8Array[] {
  const raw = process.env.AUTH_JWT_SECRETS
  if (!raw) throw new Error('AUTH_JWT_SECRETS não configurada')
  const enc = new TextEncoder()
  const secrets = raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  if (secrets.length === 0) throw new Error('AUTH_JWT_SECRETS vazia')
  if (secrets[0]!.length < 32) {
    throw new Error('AUTH_JWT_SECRETS[0] precisa ter pelo menos 32 caracteres')
  }
  return secrets.map((s) => enc.encode(s))
}

function accessTtl(): number {
  const v = Number(process.env.AUTH_ACCESS_TTL_SECONDS ?? 600)
  return Number.isFinite(v) && v > 0 ? v : 600
}

export async function signAccessToken(
  claims: AccessTokenClaims,
): Promise<string> {
  const [signing] = getSecrets()
  return new SignJWT({
    sid: claims.sid,
    locale: claims.locale,
    mfaLevel: claims.mfaLevel,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + accessTtl())
    .setIssuer('k-veritas')
    .setAudience('k-veritas:web')
    .sign(signing!)
}

export async function verifyAccessToken(
  token: string,
): Promise<InternalClaims | null> {
  for (const secret of getSecrets()) {
    try {
      const { payload } = await jwtVerify(token, secret, {
        issuer: 'k-veritas',
        audience: 'k-veritas:web',
      })
      return payload as unknown as InternalClaims
    } catch (err) {
      if (
        err instanceof joseErrors.JWSSignatureVerificationFailed ||
        err instanceof joseErrors.JWSInvalid
      ) {
        continue
      }
      return null
    }
  }
  return null
}
