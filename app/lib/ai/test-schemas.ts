import 'server-only'
import { z } from 'zod'

/**
 * Contrato estrito do output do LLM pra geração de arquivos de teste.
 *
 * Cada item em `files` vira um row em `generated_tests` + arquivo físico
 * eventualmente. O `featureExternalId` rastreia qual feature do editor
 * originou o arquivo (pra associação no DB).
 */

export const GeneratedFileSchema = z.object({
  featureExternalId: z.string().min(1).max(200),
  featureName: z.string().min(1).max(200),
  path: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .regex(/^[A-Za-z0-9._/-]+\.spec\.ts$/, {
      message: 'path must end in .spec.ts and contain only safe characters',
    }),
  code: z.string().min(50).max(100_000),
  scenarioIds: z.array(z.string()).default([]),
})

export const TestGenerationOutputSchema = z.object({
  summary: z.string().min(10).max(600),
  files: z.array(GeneratedFileSchema).min(1).max(100),
})

export type GeneratedFile = z.infer<typeof GeneratedFileSchema>
export type TestGenerationOutput = z.infer<typeof TestGenerationOutputSchema>
