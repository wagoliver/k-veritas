import 'server-only'

import { encryptSecret, decryptSecret } from '@/lib/auth/totp'

/**
 * Cifra API key do provider de IA usando a mesma chave AES-GCM do TOTP
 * (AUTH_MFA_ENCRYPTION_KEY). Reusa a infra de segredos.
 */
export function encryptApiKey(plaintext: string): Buffer {
  return encryptSecret(plaintext)
}

export function decryptApiKey(payload: Buffer): string {
  return decryptSecret(payload)
}

/**
 * Máscara para exibir que uma chave está salva sem revelar o valor.
 * Retorna null quando não há chave.
 */
export function maskApiKey(hasKey: boolean): string | null {
  return hasKey ? '••••••••' : null
}
