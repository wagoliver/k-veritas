# analyzer-opencode — Abordagem B

Container Docker que instala o CLI do [OpenCode](https://opencode.ai) e
roda em modo não-interativo sobre um diretório de código-fonte montado
em `/repo`. A saída conversacional é passada por um parser em Node que
extrai o maior objeto JSON balanceado e valida contra `AnalysisSchema`.

## Por quê

Testar se um agente pronto (multi-provider, maduro em navegação de repo)
entrega resultado comparável ao worker custom da Abordagem A, com menos
código de cola. O custo é ter que parsear saída textual e lidar com
dependência externa versionada.

## Aviso importante

A CLI do OpenCode evolui rápido. A flag exata de modo não-interativo é
`opencode run "<prompt>"` nas versões recentes. **Antes da primeira
rodada**, confirme em `opencode run --help` dentro do container e ajuste
`entrypoint.sh` se necessário.

## Build

```bash
cd spike/analyzer-opencode
docker build -t kv-spike/analyzer-opencode .
```

## Uso

```bash
# descompactar a fixture primeiro (se ainda não foi)
mkdir -p ../fixtures/unpacked
unzip ../fixtures/app-source.zip -d ../fixtures/unpacked/app-source

# rodar — monta /repo e /results, exporta a API key
docker run --rm \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e ANALYZER_MODEL="anthropic/claude-sonnet-4-5-20250929" \
  -v "$(pwd)/../fixtures/unpacked/app-source:/repo:ro" \
  -v "$(pwd)/../results:/results" \
  kv-spike/analyzer-opencode
```

Saída:

- `stdout` → o `Analysis` como JSON (vazio se schema inválido).
- `stderr` → log do container + parser.
- `../results/run-<id>-opencode.json` → métricas + saída bruta do opencode + stderr bruto.

## Limitações conhecidas (a medir no spike)

1. **Sem contagem de tokens no CLI**: o OpenCode não imprime tokens in/out por default. Fica em `null` no JSON de métricas — anote manualmente pelo dashboard do provider.
2. **System prompt concatenado**: nosso prompt vai junto da user message, porque a CLI não expõe um canal separado. O default system prompt do opencode ainda fica ativo.
3. **Sem controle fino de tool calls**: confiamos no agente decidir quando parar. Isso pode encarecer ou alongar rodadas.
4. **Licenciamento**: Apache-2.0. Conferir sem cláusulas novas antes de virar dependência de produto.

## Estrutura

```
.
├── Dockerfile           # alpine + node + ripgrep + opencode-ai
├── entrypoint.sh        # orquestra uma rodada
├── system-prompt.md     # prompt passado como primeira mensagem
└── parser/              # extrai JSON da saída conversacional + valida schema
    ├── package.json
    ├── tsconfig.json
    ├── schema.ts
    └── parse.ts
```
