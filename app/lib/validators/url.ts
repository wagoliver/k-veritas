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
