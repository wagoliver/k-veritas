import { z } from 'zod'

export const authKindSchema = z.enum(['none', 'form'])
export const sourceTypeSchema = z.enum(['url', 'repo'])

export const authFormSchema = z.object({
  loginUrl: z.string().url(),
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(256),
})

const targetLocaleSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'invalid_locale')
  .max(10)

// Aceita https://, git@ e URL estilo gh CLI (github.com/owner/repo).
// Validação estrita (host == github.com, path com >= 2 segmentos) fica
// no validateRepoUrl do url.ts — aqui só garante o shape mínimo.
const repoUrlSchema = z.string().trim().min(6).max(2048)
const repoBranchSchema = z.string().trim().min(1).max(100).default('main')
const businessContextSchema = z.string().trim().max(20_000).optional()

export const testTypeSchema = z.enum([
  'e2e',
  'smoke',
  'regression',
  'integration',
])
export type TestType = z.infer<typeof testTypeSchema>

const testScenariosSchema = z
  .array(z.string().trim().min(4).max(500))
  .max(50)
  .optional()

const testTypesSchema = z.array(testTypeSchema).max(4).optional()

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    sourceType: sourceTypeSchema.default('url'),
    // targetUrl é obrigatório para sourceType='url'; opcional para 'repo'.
    targetUrl: z.string().trim().url().max(2048).optional(),
    repoUrl: repoUrlSchema.optional(),
    repoBranch: repoBranchSchema.optional(),
    description: z.string().trim().max(4000).optional(),
    businessContext: businessContextSchema,
    authKind: authKindSchema.default('none'),
    authForm: authFormSchema.optional(),
    targetLocale: targetLocaleSchema.optional(),
    scenarios: z.array(z.string().trim().min(4).max(500)).max(50).default([]),
    // Flag client-side que indica que o ZIP será subido logo após o
    // POST /projects. Libera a criação com sourceType='repo' sem
    // repoUrl — o client faz PUT /repo/upload em seguida.
    pendingZipUpload: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.authKind === 'form' && !v.authForm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'auth_form_required',
        path: ['authForm'],
      })
    }
    if (v.sourceType === 'url' && !v.targetUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target_url_required',
        path: ['targetUrl'],
      })
    }
    // Projetos 'repo' sem repoUrl são válidos quando o usuário pretende
    // fazer upload de ZIP depois (fluxo do wizard com 3ª opção "Upload").
    // A análise só dispara se houver fonte concreta (repo_url ou
    // repo_zip_path) — checado no endpoint /ai/analyze.
    if (v.sourceType === 'repo' && !v.repoUrl && v.pendingZipUpload !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'repo_url_required',
        path: ['repoUrl'],
      })
    }
  })

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  targetUrl: z.string().trim().url().max(2048).optional(),
  description: z.string().trim().max(4000).optional(),
  authKind: authKindSchema.optional(),
  authForm: authFormSchema.optional(),
  crawlMaxDepth: z.number().int().min(1).max(10).optional(),
  targetLocale: targetLocaleSchema.optional(),
  repoUrl: repoUrlSchema.optional(),
  repoBranch: repoBranchSchema.optional(),
  businessContext: businessContextSchema,
  testScenarios: testScenariosSchema,
  testTypes: testTypesSchema,
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
