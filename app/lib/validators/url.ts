/**
 * Valida URL alvo para crawler.
 * Rejeita localhost/RFC1918 a menos que ALLOW_PRIVATE_URLS=true (dev).
 */
export function validateTargetUrl(input: string): {
  ok: boolean
  url?: URL
  reason?: string
} {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'invalid_protocol' }
  }

  const allowPrivate = process.env.ALLOW_PRIVATE_URLS === 'true'
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    return { ok: false, reason: 'private_host_blocked' }
  }

  return { ok: true, url }
}

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '0.0.0.0' || h === '[::]' || h === '::') return true
  if (h.startsWith('127.')) return true

  const parts = h.split('.')
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number) as [number, number]
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
  }

  if (h.includes(':')) {
    // IPv6 básico — bloqueia loopback/link-local/ULA
    if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) {
      return true
    }
  }

  return false
}

/**
 * Normaliza uma URL de repo GitHub vinda do usuário. Aceita os três
 * formatos que a UI oferece e retorna uma URL https canônica:
 *
 *   https://github.com/wagoliver/k-veritas.git    → https://github.com/wagoliver/k-veritas.git
 *   https://github.com/wagoliver/k-veritas        → https://github.com/wagoliver/k-veritas.git
 *   git@github.com:wagoliver/k-veritas.git        → https://github.com/wagoliver/k-veritas.git
 *   gh repo clone wagoliver/k-veritas             → https://github.com/wagoliver/k-veritas.git
 *   wagoliver/k-veritas                           → https://github.com/wagoliver/k-veritas.git
 *
 * No MVP só aceitamos repos do GitHub (host == github.com) porque
 * é o único provedor integrado. Bitbucket/GitLab podem vir em fase
 * posterior.
 */
export function validateRepoUrl(input: string): {
  ok: boolean
  normalized?: string
  reason?: string
} {
  const raw = input.trim()
  if (!raw) return { ok: false, reason: 'invalid_repo_url' }

  // gh CLI short form: "gh repo clone owner/repo"
  const ghMatch = raw.match(/^gh\s+repo\s+clone\s+([\w.-]+\/[\w.-]+)/i)
  if (ghMatch) {
    return {
      ok: true,
      normalized: `https://github.com/${ghMatch[1].replace(/\.git$/, '')}.git`,
    }
  }

  // git@github.com:owner/repo(.git)
  const sshMatch = raw.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(\.git)?$/i)
  if (sshMatch) {
    return {
      ok: true,
      normalized: `https://github.com/${sshMatch[1]}.git`,
    }
  }

  // owner/repo shorthand
  if (/^[\w.-]+\/[\w.-]+$/.test(raw) && !raw.startsWith('http')) {
    return {
      ok: true,
      normalized: `https://github.com/${raw.replace(/\.git$/, '')}.git`,
    }
  }

  // https://github.com/owner/repo(.git)
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') {
      return { ok: false, reason: 'invalid_repo_url' }
    }
    if (url.hostname.toLowerCase() !== 'github.com') {
      return { ok: false, reason: 'only_github_supported' }
    }
    const pathParts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (pathParts.length < 2) {
      return { ok: false, reason: 'invalid_repo_url' }
    }
    const [owner, repoRaw] = pathParts
    const repo = repoRaw.replace(/\.git$/, '')
    if (!owner || !repo) return { ok: false, reason: 'invalid_repo_url' }
    return { ok: true, normalized: `https://github.com/${owner}/${repo}.git` }
  } catch {
    return { ok: false, reason: 'invalid_repo_url' }
  }
}
