/**
 * Mapa pathname-segment → chave i18n.
 * Segmentos não listados aparecem literal (útil para IDs futuros).
 */
export const BREADCRUMB_LABELS: Record<string, string> = {
  projects: 'breadcrumbs.projects',
  new: 'breadcrumbs.new',
  settings: 'breadcrumbs.settings',
  profile: 'breadcrumbs.profile',
  security: 'breadcrumbs.security',
  activity: 'breadcrumbs.activity',
  team: 'breadcrumbs.team',
  mfa: 'breadcrumbs.mfa',
  enroll: 'breadcrumbs.mfa_enroll',
  verify: 'breadcrumbs.mfa_verify',
}

/**
 * Retorna uma chave i18n para o segmento, ou null se devemos usar o
 * segmento literal (ex.: slugs dinâmicos de projeto).
 */
export function labelKeyFor(segment: string): string | null {
  return BREADCRUMB_LABELS[segment] ?? null
}
