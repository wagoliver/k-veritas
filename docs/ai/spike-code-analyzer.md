# Spike — agente de análise de código (code-first)

> **Status**: RASCUNHO (protótipos prontos, rodadas ainda não executadas).
>
> Atualize este documento com os números reais depois de rodar o spike.

## Por que este spike existe

A aba "Análise de código em breve" (`app/components/projects/site-map-tabs.tsx`)
é hoje um placeholder. Antes de construir a feature, precisamos escolher
**que tipo de agente** vai ler o código-fonte do projeto do usuário e
gerar features/cenários alinhados ao `AnalysisSchema`
(`app/lib/ai/schemas.ts`).

Caminhos em comparação:

- **(A) Worker custom com tool-use** — SDK da Anthropic expõe tools
  `list_dir`, `read_file`, `grep`; loop agêntico manual; saída forçada
  a JSON via prompt + validação Zod.
- **(B) OpenCode headless em container** — CLI pronto, multi-provider,
  saída conversacional parseada pra extrair JSON.

Terceiro caminho (Claude Code CLI) foi descartado no plano pelo
acoplamento ao provider Anthropic e incerteza de licenciamento pra uso
em SaaS.

Plano original: `C:\Users\wagneroliveira\.claude\plans\vamos-falar-do-an-lise-transient-frog.md`.

## Dataset

- Fixture: ZIP do `app/` do próprio k-veritas (Next.js App Router, Zod,
  Drizzle, i18n, auth com MFA) — `spike/fixtures/app-source.zip`.
- Gabarito manual: `spike/fixtures/ground-truth.json` com ~8 features e
  ~20 cenários esperados. Marcar como `reviewStatus: "revisado"` antes
  de rodar — hoje está `RASCUNHO`.

## Protocolo das rodadas

- Mesmo modelo em ambas as abordagens: **Anthropic Claude Sonnet 4.6**
  (`claude-sonnet-4-5-20250929`), temperatura default.
- **3 rodadas por abordagem** (6 no total).
- Mesmo ZIP de entrada, mesmo gabarito.

## Eixos de decisão

| Eixo | Como medir | Fonte |
|---|---|---|
| Qualidade | Precision/recall contra `ground-truth.json`: feature "encontrada" = ≥50% dos `expectedPaths` cobertos; cenário "encontrado" = match semântico (julgamento humano) | `analysis` em cada `run-*.json` |
| Custo | Tokens in × preço input + Tokens out × preço output (Sonnet 4.6: $3/MTok in, $15/MTok out) | `tokensIn`/`tokensOut` em `run-*-custom.json`; dashboard Anthropic pra `opencode` |
| Tempo | `durationMs` | ambos |
| Robustez do JSON | Taxa de `schemaValid=true` sem retry | `schemaValid` em cada `run-*.json` |
| Complexidade de integração | LoC + dependências novas pra virar worker de fila | auditoria manual |

Critério de vitória: ganhar em **≥3 dos 5 eixos**, ou perder só por
margem pequena nos demais.

## Resultados — preencher

### Rodadas individuais

| # | Abordagem | Válido | Tempo (ms) | Tokens in | Tokens out | Custo est. (USD) | Features identificadas | Obs |
|---|---|---|---|---|---|---|---|---|
| 1 | custom | — | — | — | — | — | — | — |
| 2 | custom | — | — | — | — | — | — | — |
| 3 | custom | — | — | — | — | — | — | — |
| 4 | opencode | — | — | — | — | — | — | — |
| 5 | opencode | — | — | — | — | — | — | — |
| 6 | opencode | — | — | — | — | — | — | — |

### Qualidade (média das 3 rodadas)

| Abordagem | Precision | Recall | Cobertura de rotas | Cenários com match |
|---|---|---|---|---|
| custom | — | — | — | — |
| opencode | — | — | — | — |

### Integração

| Abordagem | LoC de cola no produto | Dependências novas | Risco operacional |
|---|---|---|---|
| custom | — | `@anthropic-ai/sdk` já usável via abstração; `ripgrep` no container | baixo (padrão dos workers existentes) |
| opencode | — | `opencode-ai` (CLI externo); imagem Docker ~400MB; parser de saída conversacional | médio (dep externa em evolução rápida; licenciamento a confirmar) |

## Recomendação final

> A preencher depois das rodadas.

Template:

- **Escolhido**: (A) ou (B).
- **Motivo em uma frase**: …
- **Trade-off aceito**: …
- **Próximos passos pra feature real**: `code_analysis_jobs` no Postgres,
  worker container no padrão `crawler/runner`, ingestão por ZIP e depois
  GitHub PAT, regra "crawler só se não houver repo" no orquestrador.

## Artefatos

- `spike/analyzer-custom/` — Abordagem A.
- `spike/analyzer-opencode/` — Abordagem B.
- `spike/fixtures/ground-truth.json` — gabarito.
- `spike/results/run-*.json` — métricas brutas das 6 rodadas (gitignored).
