import 'server-only'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'

// Argon2id é o algoritmo padrão da lib @node-rs/argon2.
const PARAMS = {
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const

function pepper(): string {
  const p = process.env.AUTH_PASSWORD_PEPPER
  if (!p || p.length < 8) {
    throw new Error('AUTH_PASSWORD_PEPPER não configurado ou muito curto')
  }
  return p
}

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain + pepper(), PARAMS)
}

export async function verifyPassword(
  stored: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argonVerify(stored, plain + pepper())
  } catch {
    return false
  }
}
