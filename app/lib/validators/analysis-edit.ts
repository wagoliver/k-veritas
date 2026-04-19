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

export const updateFeatureSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().min(5).max(500).optional(),
  paths: z.array(pathSchema).max(50).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  reviewed: z.boolean().optional(),
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
