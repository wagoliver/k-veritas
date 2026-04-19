# k-veritas

> Testes que dizem a verdade.

Plataforma de autoria e execução de testes automatizados em **Playwright**,
assistida por **LLM**, para equipes de QA que querem codificar menos
passo-a-passo e afirmar mais invariantes.

## Por trás do nome

**_Veritas_** vem do latim — _verdade_.
**K** é um aceno aos _Knights & Knaves_, o problema lógico dos dois guardiões:
um sempre diz a verdade (o Knight), o outro sempre mente (o Knave). A analogia
encaixa bem com QA: todo teste é uma proposição — ou passa (verdade) ou falha
(mentira). O trabalho do time é decidir quais proposições valem a pena afirmar.

## Status

`v0.0.1` — fundação: autenticação segura + infraestrutura de dados.
Editor de testes, runner Playwright e integração com LLM virão em fases
seguintes (veja [Roadmap](#roadmap)).

## Stack

| Camada | Tecnologia |
|---|---|
| Web / BFF | Next.js 16 (App Router) + React 19 |
| UI | Tailwind CSS v4, shadcn/ui, Radix, Lucide, motion/react, recharts |
| i18n | next-intl (pt-BR / en-US) |
| Identidade | Argon2id (`@node-rs/argon2`), JWT via `jose`, TOTP via `otpauth` |
| Cadastro | PostgreSQL 16 + Drizzle ORM |
| Transacional / Telemetria | ClickHouse 24 + `@clickhouse/client` |
| Runtime | Node.js 24 LTS (Fluid Compute compatível) |
| Empacotamento | Docker Compose (Next standalone + Postgres + ClickHouse) |
| Futuro | Playwright, AI SDK (Vercel AI Gateway) |

## Princípios

1. **Zero CDN em runtime.** Toda fonte, CSS e JS é servido pelo próprio app.
2. **Reprodutível localmente.** Um `docker compose up -d --build` sobe tudo.
3. **Segurança primeiro.** Argon2id, refresh rotativo, MFA TOTP, rate limit,
   mensagens genéricas contra enumeração, trilha de auditoria dupla
   (Postgres + ClickHouse).
4. **i18n nativo.** pt-BR e en-US desde o primeiro commit.

## Arquitetura em alto nível

```
             ┌────────────────────────┐
 Navegador ─►│  Next.js App Router    │
             │  (páginas + /api/auth) │
             └─────────┬──────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
    ┌──────────┐             ┌──────────────┐
    │ Postgres │             │  ClickHouse  │
    │ cadastro │             │  telemetria  │
    │ + sessão │             │  + eventos   │
    └──────────┘             └──────────────┘

                ◇ fases seguintes ◇
         LLM Gateway • Playwright runner
```

## Pré-requisitos

- Docker Desktop (ou Docker Engine + Compose v2)

> Todo o stack — app Next.js em modo produção, Postgres e ClickHouse —
> sobe via Docker Compose. Não é necessário instalar Node ou pnpm na
> máquina para usar.

## Setup local

```bash
# 1. configurar ambiente (gere secrets reais antes de subir)
cp app/.env.example app/.env.local

# 2. subir tudo (app + Postgres + ClickHouse, aplica migrations)
docker compose up -d --build
```

App disponível em <http://localhost:3000> (redireciona para `/pt-BR/login`).

### Gerando secrets para `app/.env.local`

```bash
# AUTH_JWT_SECRETS (>= 32 chars)
openssl rand -hex 48

# AUTH_MFA_ENCRYPTION_KEY (32 bytes em base64, com prefixo base64:)
echo "base64:$(openssl rand -base64 32)"

# AUTH_PASSWORD_PEPPER
openssl rand -hex 24
```

### Comandos úteis

```bash
docker compose logs -f app       # acompanhar logs do Next
docker compose logs migrate      # ver saída das migrations
docker compose down              # derrubar tudo (volumes preservados)
docker compose down -v           # derrubar tudo + zerar dados
docker compose up -d --build     # rebuild após mudanças no código
```

### Desenvolvimento fora do Docker (opcional)

Se preferir iterar com hot-reload local:

```bash
docker compose up -d postgres clickhouse     # só os bancos
pnpm --dir app install
pnpm --dir app db:push
pnpm --dir app ch:migrate
pnpm --dir app dev                           # Next em :3000
```

## Estrutura de pastas

```
k-veritas/
├── app/                 # aplicação Next.js (auth + telas futuras)
├── template/            # referência visual original (não tocar)
├── docker-compose.yml   # app + Postgres + ClickHouse
└── README.md
```

## Roadmap

### ✓ Fase 1 — Fundação

Auth (login, registro, reset, MFA TOTP), Postgres + ClickHouse, i18n pt-BR/en-US, shell SaaS (sidebar, command palette, settings).

### ✓ Fase 2 — Autoria

- **2.0** Shell de projetos + configurações
- **2.1** Criar projeto + crawler Playwright (container separado) + captura DOM/elements/screenshots + BFS com controle de profundidade
- **2.2** Análise IA: abstração de provider (Ollama, Anthropic, OpenAI-compat), streaming de tokens, geração de features/cenários com schema JSON estrito, edição humano-na-volta, histórico por cenário
- **2.3** Geração Playwright: `.spec.ts` por feature granular por cenário, visualização em fluxo Given/When/Then, download ZIP, delete/regeneração por cenário, preservação de histórico em ClickHouse

### ☐ Fase 3 — Execução

- Runner Playwright em container isolado (mesmo padrão do crawler)
- Fila `test_exec_jobs` no Postgres
- **Executar passo isolado** quando o ambiente estiver pronto — rodar um único `test(...)` de um cenário específico pra iterar sem disparar a suíte inteira
- Resultado por cenário: passed/failed/flaky + trace viewer + screenshot de falha
- Badges inline no card do cenário (último run) + histórico de execuções no CH
- Webhook pra receber resultados de CI externo

### ☐ Fase 4 — Relatórios

- Dashboards de taxa de sucesso por feature/projeto/período
- Grafo temporal de crawls (mostra evolução do app ao longo do tempo)
- Diff entre crawls: quais páginas/elementos mudaram
- Aproveita o visual do `template/`

### Ideias em backlog (sem fase definida)

- Modo Avançado de ingestão: carregar código-fonte junto com DOM pra enriquecer contexto da IA (GitHub PAT + clone raso ou upload de zip)
- Export Gherkin `.feature` direto de cada cenário
- Dialog de confirmação do Recrawlear com contexto ("último crawl: 2h atrás · 47 páginas")
- Badge "análise desatualizada" quando o crawl é mais recente que a análise
- Seletor de modelo por feature (crítico = Opus, simples = Haiku)
- Limpeza automática de crawls antigos (hoje só o mais recente fica no PG; histórico comprimido no CH — faltam dashboards que exponham isso)

## Segurança

Falhas de segurança devem ser reportadas em privado (canal a definir).
Política completa virá em `SECURITY.md` na fase 2.

## Licença

A definir.

---

<details>
<summary><strong>English summary</strong></summary>

**k-veritas** is a Playwright + LLM test-authoring platform.

The name pairs _veritas_ (Latin for _truth_) with _K_ from the classic
Knights & Knaves puzzle: one guard always tells the truth, the other always
lies. Tests are the same — they either pass (truth) or fail (lie).

Current phase (`v0.0.1`): hardened authentication foundation (Argon2id, JWT
with rotating refresh, TOTP MFA) on top of PostgreSQL (user data) and
ClickHouse (auth telemetry). Everything self-hosted — no CDN dependencies at
runtime. UI available in Portuguese (pt-BR) and English (en-US).

One-command bootstrap:

```bash
cp app/.env.example app/.env.local
docker compose up -d --build
```

</details>
