import 'server-only'

/**
 * Remove fences markdown e corta lixo antes/depois do JSON.
 * Necessário porque alguns modelos envolvem o output em ```json ... ```
 * mesmo quando pedido format=json / response_format=json_object.
 */
export function sanitizeJsonResponse(text: string): string {
  let cleaned = text.trim()

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenceMatch?.[1]) cleaned = fenceMatch[1].trim()

  const start = cleaned.search(/[{[]/)
  if (start > 0) cleaned = cleaned.slice(start)

  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
  if (end > 0) cleaned = cleaned.slice(0, end + 1)

  return cleaned
}
