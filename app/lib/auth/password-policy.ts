import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 12

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: 'policy.min_length' })
  .max(256, { message: 'policy.max_length' })
  .refine((v) => /[a-z]/.test(v), { message: 'policy.lowercase' })
  .refine((v) => /[A-Z]/.test(v), { message: 'policy.uppercase' })
  .refine((v) => /\d/.test(v), { message: 'policy.digit' })
  .refine((v) => /[^A-Za-z0-9]/.test(v), { message: 'policy.symbol' })

export function passwordStrength(v: string): 0 | 1 | 2 | 3 | 4 {
  let score = 0
  if (v.length >= PASSWORD_MIN_LENGTH) score++
  if (v.length >= 16) score++
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4
}
