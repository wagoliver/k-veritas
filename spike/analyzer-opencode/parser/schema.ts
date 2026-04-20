import { z } from 'zod'

export const PrioritySchema = z.enum(['critical', 'high', 'normal', 'low'])

export const ScenarioSchema = z.object({
  title: z.string().trim().min(6).max(140),
  rationale: z.string().trim().min(10).max(240),
  priority: PrioritySchema,
  preconditions: z.array(z.string().max(160)).default([]),
  dataNeeded: z.array(z.string().max(120)).default([]),
})

export const FeatureSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id deve ser kebab-case'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(280),
  paths: z.array(z.string().regex(/^\//)).min(1),
  scenarios: z.array(ScenarioSchema).min(3).max(8),
})

export const AnalysisSchema = z.object({
  summary: z.string().trim().min(40).max(600),
  inferredLocale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'formato BCP-47 esperado'),
  features: z.array(FeatureSchema).min(1),
})

export type Analysis = z.infer<typeof AnalysisSchema>
