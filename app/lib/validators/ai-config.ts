import { z } from 'zod'

export const aiProviderSchema = z.enum([
  'ollama',
  'openai-compatible',
  'anthropic',
])

const baseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .url()
  .refine((v) => /^https?:\/\//.test(v), {
    message: 'URL precisa usar http ou https',
  })

export const aiConfigInputSchema = z.object({
  provider: aiProviderSchema,
  baseUrl: baseUrlSchema,
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(1).max(500).optional().or(z.literal('')),
  clearApiKey: z.boolean().optional(),
  temperature: z.number().min(0).max(2),
  numCtx: z.number().int().min(512).max(131072),
  timeoutMs: z.number().int().min(5_000).max(1_800_000),
})

export type AiConfigInput = z.infer<typeof aiConfigInputSchema>

export const aiConfigTestSchema = z.object({
  provider: aiProviderSchema,
  baseUrl: baseUrlSchema,
  apiKey: z.string().trim().min(1).max(500).optional().or(z.literal('')),
  useSavedApiKey: z.boolean().optional(),
})

export type AiConfigTestInput = z.infer<typeof aiConfigTestSchema>
