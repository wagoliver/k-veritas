// Prompt-placeholder enquanto o "miolo" (sistema que o usuário vai
// compartilhar) não é integrado. Serve pra exercitar a casca ponta a
// ponta — Claude Code recebe o repo + context.md e escreve um
// manifest.json mínimo válido (1 feature, 3 cenários).
//
// Quando o miolo chegar, este arquivo é substituído pela versão real.
// O contrato de saída ({ summary, inferredLocale, features[] } aderente
// ao AnalysisSchema em app/lib/ai/schemas.ts) precisa ser preservado.

export interface PromptInput {
  projectName: string
  targetLocale: string
  jobRoot: string // /work/<jobId>
  outputDir: string // /work/<jobId>/output
}

export function buildPrompt(input: PromptInput): string {
  return `Você é um QA Architect. Analise o código-fonte no diretório atual
(já é o seu cwd: o repositório clonado do projeto "${input.projectName}") e
produza uma análise de cobertura de testes.

Leia o arquivo "${input.jobRoot}/context.md" antes de começar — ele tem
o caso de uso e as regras de negócio escritas pela QA (pode estar vazio).

Explore o repositório usando as ferramentas disponíveis (Read, Glob, Grep).
Não escreva código em lugar nenhum do repositório — ele é read-only para você.

Quando terminar, escreva um arquivo JSON em:
  ${input.outputDir}/manifest.json

Com o seguinte formato (aderente estrito ao AnalysisSchema):

{
  "summary": "2-3 frases descrevendo o propósito do sistema.",
  "inferredLocale": "${input.targetLocale}",
  "features": [
    {
      "id": "kebab-case-slug",
      "name": "Nome curto",
      "description": "Frase curta sobre a capacidade.",
      "paths": ["/alguma-rota"],
      "scenarios": [
        {
          "title": "Verbo-primeiro — descrição curta",
          "rationale": "Por que vale testar (valor de negócio).",
          "priority": "critical | high | normal | low",
          "preconditions": [],
          "dataNeeded": []
        }
      ]
    }
  ]
}

Regras:
- Entre 1 e N features. Cada feature precisa de 3 a 8 cenários.
- Paths começam com "/". Use o literal do framework para rotas dinâmicas
  (ex.: "/projects/[projectId]").
- Não invente rotas sem correspondência no código.
- Idioma da saída: "${input.targetLocale}".
- O primeiro caractere do manifest.json deve ser "{" e o último "}".
  Nada de markdown fences.

Quando o manifest estiver escrito, responda apenas "done".`
}
