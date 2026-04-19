import 'server-only'
import { z } from 'zod'

/**
 * Contrato do output do LLM — agora granular por scenario.
 *
 * Cada feature é um arquivo .spec.ts composto de:
 *   - fileHeader: imports + declaração test.describe(..., () => {
 *   - tests[].code: cada bloco test('título', ..., async () => { ... })
 *   - fileFooter: } que fecha o describe
 *
 * O orquestrador concatena no download pra formar o arquivo final. Isso
 * permite à UI mostrar cada teste dentro do próprio scenario sem parsear
 * o arquivo completo.
 */

export const FileTestSchema = z.object({
  scenarioId: z.string().uuid(),
  code: z
    .string()
    .min(20)
    .max(20_000)
    // Força que o código comece com `test(` pra garantir granularidade
    .refine(
      (c) => /^\s*test\(/.test(c),
      'code must start with a `test(` block',
    ),
})

export const GeneratedFeatureFileSchema = z.object({
  featureExternalId: z.string().min(1).max(200),
  featureName: z.string().min(1).max(200),
  filePath: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .regex(/^[A-Za-z0-9._/-]+\.spec\.ts$/, {
      message: 'filePath must end in .spec.ts and contain only safe characters',
    }),
  fileHeader: z.string().min(10).max(5_000),
  fileFooter: z.string().min(1).max(500),
  tests: z.array(FileTestSchema).min(1).max(50),
})

export const TestGenerationOutputSchema = z.object({
  summary: z.string().min(10).max(600),
  files: z.array(GeneratedFeatureFileSchema).min(1).max(100),
})

export type GeneratedFeatureFile = z.infer<typeof GeneratedFeatureFileSchema>
export type TestGenerationOutput = z.infer<typeof TestGenerationOutputSchema>
