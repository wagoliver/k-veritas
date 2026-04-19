import 'server-only'

import { OllamaClient } from './providers/ollama'
import { OpenAICompatibleClient } from './providers/openai-compatible'
import { resolveAiConfig } from './config'
import type { AIClient, AIProviderConfig } from './types'

export function buildClient(config: AIProviderConfig): AIClient {
  switch (config.provider) {
    case 'ollama':
      return new OllamaClient(config)
    case 'openai-compatible':
    case 'anthropic':
      // Anthropic usa o mesmo client OpenAI-compatible: /v1/chat/completions.
      // Headers específicos (x-api-key, anthropic-version) + supressão de
      // response_format são detectados automaticamente quando a base URL
      // aponta pra api.anthropic.com.
      return new OpenAICompatibleClient(config)
    default: {
      const never: never = config.provider
      throw new Error(`Unknown AI provider: ${String(never)}`)
    }
  }
}

export async function getClientForOrg(orgId: string): Promise<AIClient> {
  const config = await resolveAiConfig(orgId)
  return buildClient(config)
}
