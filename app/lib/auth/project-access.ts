import 'server-only'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { orgMembers, projects, type Project } from '@/lib/db/schema'

/**
 * Garante que o usuário tem acesso ao projeto via membership na org dona.
 * Retorna o projeto se autorizado, null caso contrário.
 */
export async function authorizeProject(
  userId: string,
  projectId: string,
): Promise<Project | null> {
  const [row] = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(orgMembers, eq(orgMembers.orgId, projects.orgId))
    .where(and(eq(projects.id, projectId), eq(orgMembers.userId, userId)))
    .limit(1)

  return row?.project ?? null
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project'
}
