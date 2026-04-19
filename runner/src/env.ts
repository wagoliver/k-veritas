export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || v.length === 0) {
    throw new Error(`[runner] missing env ${name}`)
  }
  return v
}

export function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}
