import { z } from 'zod'

export const priorityEnum = z.enum(['critical', 'high', 'normal', 'low'])

const pathSchema = z.string().trim().min(1).max(500)
const stringListSchema = z
  .array(z.string().trim().min(1).max(200))
  .max(20)

export const createFeatureSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(500),
  paths: z.array(pathSchema).max(50).default([]),
})

const codeFocusItemSchema = z.object({
  path: z.string().trim().min(1).max(500),
  mode: z.enum(['focus', 'ignore']),
})

const envVarNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Z_][A-Z0-9_]*$/, 'env var deve ser UPPER_SNAKE_CASE')

export const coveragePriorityEnum = priorityEnum

export const updateFeatureSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().min(5).max(500).optional(),
  paths: z.array(pathSchema).max(50).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  reviewed: z.boolean().optional(),
  // Contexto por-feature LEGADO. Mantidos no validator porque as colunas
  // no banco ainda existem e o dev pode enviar via Swagger/Postman — mas
  // a UI nova não usa mais. Serão removidos quando Cenário estabilizar.
  businessRule: z.string().trim().max(5_000).nullable().optional(),
  testRestrictions: z.string().trim().max(2_000).nullable().optional(),
  codeFocus: z.array(codeFocusItemSchema).max(50).optional(),
  expectedEnvVars: z.array(envVarNameSchema).max(20).optional(),
  coveragePriorities: z.array(coveragePriorityEnum).max(4).optional(),
  // Novo modelo: entendimento + cenários gerados pela IA + aprovação.
  // Cenários são objetos com descrição + prioridade (crítico/alto/normal/baixo)
  // que a IA atribui por cenário; QA pode ajustar via dropdown.
  aiUnderstanding: z.string().trim().max(10_000).nullable().optional(),
  aiScenarios: z
    .array(
      z.object({
        description: z.string().trim().min(4).max(500),
        priority: priorityEnum,
      }),
    )
    .max(20)
    .optional(),
})

export const createFeatureFreeScenarioSchema = z.object({
  description: z.string().trim().min(4).max(500),
  priority: z.number().int().min(0).max(100).default(0),
})

export const updateFeatureFreeScenarioSchema = z.object({
  description: z.string().trim().min(4).max(500).optional(),
  priority: z.number().int().min(0).max(100).optional(),
})

export const createScenarioSchema = z.object({
  title: z.string().trim().min(4).max(200),
  rationale: z.string().trim().min(5).max(500),
  priority: priorityEnum.default('normal'),
  preconditions: stringListSchema.default([]),
  dataNeeded: stringListSchema.default([]),
})

export const updateScenarioSchema = z.object({
  title: z.string().trim().min(4).max(200).optional(),
  rationale: z.string().trim().min(5).max(500).optional(),
  priority: priorityEnum.optional(),
  preconditions: stringListSchema.optional(),
  dataNeeded: stringListSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  reviewed: z.boolean().optional(),
  moveToFeatureId: z.string().uuid().optional(),
})

export type CreateFeatureInput = z.infer<typeof createFeatureSchema>
export type UpdateFeatureInput = z.infer<typeof updateFeatureSchema>
export type CreateScenarioInput = z.infer<typeof createScenarioSchema>
export type UpdateScenarioInput = z.infer<typeof updateScenarioSchema>
export type CreateFeatureFreeScenarioInput = z.infer<
  typeof createFeatureFreeScenarioSchema
>
export type UpdateFeatureFreeScenarioInput = z.infer<
  typeof updateFeatureFreeScenarioSchema
>
export type CodeFocusItem = z.infer<typeof codeFocusItemSchema>
