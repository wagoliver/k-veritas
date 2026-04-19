import { z } from 'zod'

export const authKindSchema = z.enum(['none', 'form'])

export const authFormSchema = z.object({
  loginUrl: z.string().url(),
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(256),
})

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    targetUrl: z.string().trim().url().max(2048),
    description: z.string().trim().max(4000).optional(),
    authKind: authKindSchema.default('none'),
    authForm: authFormSchema.optional(),
    scenarios: z.array(z.string().trim().min(4).max(500)).max(50).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.authKind === 'form' && !v.authForm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'auth_form_required',
        path: ['authForm'],
      })
    }
  })

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  targetUrl: z.string().trim().url().max(2048).optional(),
  description: z.string().trim().max(4000).optional(),
  authKind: authKindSchema.optional(),
  authForm: authFormSchema.optional(),
})

export const createScenarioSchema = z.object({
  description: z.string().trim().min(4).max(500),
  priority: z.number().int().min(0).max(100).default(0),
})

export const updateScenarioSchema = z.object({
  description: z.string().trim().min(4).max(500).optional(),
  priority: z.number().int().min(0).max(100).optional(),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
export type AuthFormInput = z.infer<typeof authFormSchema>
