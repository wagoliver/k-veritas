# analyzer-custom — Abordagem A

CLI standalone que usa o SDK da Anthropic com **tool-use** (list_dir,
read_file, grep) pra explorar um diretório de código-fonte e produzir um
`Analysis` validado por `zod`.

Não é um worker de fila ainda — é um protótipo de CLI pra medir custo,
qualidade e esforço. Quando virar produto, o mesmo loop encaixa no padrão
de `crawler/src/worker.ts`.

## Pré-requisitos

- Node.js 22+ (usa `--experimental-strip-types` pra rodar `.ts` direto).
- `ripgrep` disponível no PATH (a tool `grep` usa `rg`).
- `ANTHROPIC_API_KEY` no ambiente.

## Instalação

```bash
cd spike/analyzer-custom
pnpm install   # ou npm install
```

## Uso

```bash
# descompactar a fixture primeiro
mkdir -p ../fixtures/unpacked
unzip ../fixtures/app-source.zip -d ../fixtures/unpacked/app-source

# rodar
ANTHROPIC_API_KEY=sk-ant-... \
  RESULTS_DIR=../results \
  pnpm start ../fixtures/unpacked/app-source
```

Saída:

- `stdout` → o `Analysis` como JSON (vazio se schema inválido).
- `stderr` → log de tool calls e métricas por rodada.
- `../results/run-<id>-custom.json` → métricas + resposta bruta.

## Variáveis de ambiente

| Var | Default | Descrição |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Obrigatória. |
| `ANALYZER_MODEL` | `claude-sonnet-4-5-20250929` | Nome do modelo Anthropic. |
| `ANALYZER_MAX_ITERATIONS` | `40` | Teto de rodadas de tool-use. |
| `ANALYZER_MAX_TOKENS` | `8192` | `max_tokens` por requisição. |
| `RESULTS_DIR` | `./results` | Onde gravar o JSON de métricas. |

## Estrutura

```
src/
├── schema.ts     # AnalysisSchema (cópia do app/lib/ai/schemas.ts)
├── prompt.ts     # system prompt adaptado pra code-first
├── tools.ts      # Sandbox + definições das tools
└── run.ts        # entrypoint e loop agêntico
```

## Próximas rodadas do spike

Invoque 3× pra estatística. Use `RESULTS_DIR=../results` pra os arquivos
caírem lado-a-lado com os da Abordagem B.
