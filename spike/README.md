# Spike — agente de análise de código (code-first)

Protótipos descartáveis pra decidir entre duas abordagens de análise de
código-fonte em projetos, **antes de especificar a feature real**.

Contexto e critérios: `../docs/ai/spike-code-analyzer.md`
Plano: `C:\Users\wagneroliveira\.claude\plans\vamos-falar-do-an-lise-transient-frog.md`

## Estrutura

```
spike/
├── fixtures/
│   └── ground-truth.json         # gabarito manual pra medir qualidade
├── results/                       # outputs das rodadas (gitignored)
├── analyzer-custom/               # Abordagem A — worker custom + tool-use
└── analyzer-opencode/             # Abordagem B — OpenCode headless
```

## Como rodar

Cada abordagem tem seu próprio README com instruções:

- [analyzer-custom/README.md](./analyzer-custom/README.md)
- [analyzer-opencode/README.md](./analyzer-opencode/README.md)

Ambas leem um diretório de código-fonte descompactado e imprimem um JSON
aderente ao `AnalysisSchema` (ver `app/lib/ai/schemas.ts`) no stdout.

## Fixture sugerida

O próprio `app/` do k-veritas. Pra gerar o ZIP de entrada:

```bash
# no repo root
cd app
zip -r ../spike/fixtures/app-source.zip . \
  -x "node_modules/*" -x ".next/*" -x ".git/*"
cd ..
```

## Não é produto

- Nada aqui roda no compose principal.
- Nenhuma tabela foi criada nem migração foi adicionada.
- Quando a decisão for tomada, esta pasta vai embora.
