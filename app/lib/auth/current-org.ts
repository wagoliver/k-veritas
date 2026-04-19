import 'server-only'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/pg'
import { orgMembers, orgs, type OrgRole } from '@/lib/db/schema'

export interface CurrentOrg {
  id: string
  name: string
  slug: string
  role: OrgRole
  ownerUserId: string
}

/**
 * Org "atual" do usuário na Fase 2.0.
 * Política: pega a primeira (e única) org Personal. Quando suportar
 * múltiplas orgs, substituir por cookie `active_org` + fallback.
 */
export async function getCurrentOrg(userId: string): Promise<CurrentOrg | null> {
  const [row] = await db
    .select({
      id: orgs.id,
      name: orgs.name,
      slug: orgs.slug,
      role: orgMembers.role,
      ownerUserId: orgs.ownerUserId,
    })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .orderBy(orgs.createdAt)
    .limit(1)

  if (!row) return null
  return { ...row, role: row.role as OrgRole }
}

export async function listUserOrgs(userId: string): Promise<CurrentOrg[]> {
  const rows = await db
    .select({
      id: orgs.id,
      name: orgs.name,
      slug: orgs.slug,
      role: orgMembers.role,
      ownerUserId: orgs.ownerUserId,
    })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .orderBy(orgs.createdAt)

  return rows.map((r) => ({ ...r, role: r.role as OrgRole }))
}

/**
 * Gera um slug legível a partir do nome. Para "Personal" vira "personal-xxxx".
 * Conflito de slug resolvido pelo caller via retry com sufixo aleatório.
 */
export function buildPersonalSlug(userId: string): string {
  const short = userId.split('-')[0] ?? 'x'
  return `personal-${short}`
}

export async function ensurePersonalOrg(
  userId: string,
  tx: typeof db = db,
): Promise<string> {
  const [existing] = await tx
    .select({ id: orgs.id })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
    .where(and(eq(orgMembers.userId, userId), eq(orgs.ownerUserId, userId)))
    .limit(1)

  if (existing) return existing.id

  const slug = buildPersonalSlug(userId)
  const [created] = await tx
    .insert(orgs)
    .values({
      name: 'Personal',
      slug,
      ownerUserId: userId,
    })
    .returning({ id: orgs.id })

  if (!created) throw new Error('failed to create personal org')

  await tx.insert(orgMembers).values({
    orgId: created.id,
    userId,
    role: 'owner',
  })

  return created.id
}
