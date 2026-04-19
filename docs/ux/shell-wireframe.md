# Wireframe low-fi — Shell + tela-âncora

ASCII low-fi para bater o ritmo visual antes de codar. Premissas:

- Desktop-first (≥ 1280px). Mobile é secundário (só consumo de runs).
- Densidade alta. Padding vertical de linhas em tabelas ≤ 36px.
- Dark theme obsidian + teal accent já estabelecido em `app/globals.css`.
- Tipografia: `Outfit` (display), `DM Sans` (sans), `JetBrains Mono` (mono/code).
- Todos os blocos são **shadcn/ui** + Radix. Não inventamos primitivas.

## 1. Shell global (aparece em toda tela autenticada)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ┌──────────────┐ ┌──────────────────────────────────────────────────────────────────────────────┐   │
│ │  Workspace ▾ │ │  ⌕ Buscar · Cmd+K            ●2      ○ Acme · staging        🔔 3    👤 Ana ▾ │   │
│ │  Acme Corp   │ ├──────────────────────────────────────────────────────────────────────────────┤   │
│ ├──────────────┤ │  Projects / checkout-flow / Tests                                              │   │
│ │ ▣ Projects   │ ├──────────────────────────────────────────────────────────────────────────────┤   │
│ │ ▸ Activity   │ │                                                                                │   │
│ │ ▸ Team       │ │                                                                                │   │
│ ├──────────────┤ │                                                                                │   │
│ │ checkout-flow│ │                                                                                │   │
│ │  ▸ Tests     │ │                                                                                │   │
│ │  ▸ Runs      │ │                    Área de conteúdo da tela atual                              │   │
│ │  ▸ Envs      │ │                                                                                │   │
│ │  ▸ Reports   │ │                                                                                │   │
│ │  ▸ Settings  │ │                                                                                │   │
│ ├──────────────┤ │                                                                                │   │
│ │ + New project│ │                                                                                │   │
│ └──────────────┘ └──────────────────────────────────────────────────────────────────────────────┘   │
│  220px               min-width 720px                                                                 │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ▶ 2 runs em andamento · 12 agendados hoje · commit deploy-123                            docs · help │   ← status bar (32px)
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Decisões da shell

| Zona | Largura/altura | Conteúdo | Comportamento |
|---|---|---|---|
| **Sidebar** | 220px expandida / 56px colapsada | Workspace switcher → áreas globais → projetos ancorados (máx 5) | Colapsa com `[` |
| **Topbar** | 48px | Busca (Cmd+K) · indicador de runs ativos · env atual · notificações · avatar | Sticky |
| **Breadcrumbs** | 36px | Hierarquia clicável | Truncate do meio em telas pequenas |
| **Content** | flex-1 | Tela atual | Scroll isolado |
| **Status bar** | 32px | Runs em andamento, agendados, build atual, atalhos docs | Opcional, colapsável |

### Command palette (`Cmd+K`)

Overlay centralizado, 520px × 480px, sobre toda a shell. Exemplos:
```
⌕ checkout
───────────────────────────────
  🧪 adds-to-cart (teste)
  🧪 checkout-empty-cart (teste)
  ▶ run all in checkout-flow
  📅 schedule checkout-flow @ hourly
  ⚙ open project settings
```

## 2. Tela-âncora: Test editor

A tela em que o usuário passa 70% do tempo. Split em **3 colunas**, todas
redimensionáveis (via `react-resizable-panels`):

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Projects / checkout-flow / Tests / adds-to-cart                       ▶ Run · staging ▾    Save · ⌘S │
├──────────────────────┬─────────────────────────────────────────────────┬───────────────────────────┤
│ TESTS · 42          │ adds-to-cart.spec.ts                            │ AI · Trace · Steps · Logs │
│ ⌕ filtrar · ⇧       │ ───────────────────────────────────────────────┤ ──────────────────────────│
│                     │  1  import { test, expect } from '@playwright' │  💬 Chat                   │
│ ● adds-to-cart 2s ⚠ │  2                                              │ ─────────────────────────│
│   checkout flow     │  3  test('user adds item to cart', async ({    │  IA: Quer que eu gere     │
│ ○ signs-in 800ms    │  4    page                                     │  a variante mobile desse  │
│ ○ resets-password   │  5  }) => {                                     │  teste?                   │
│ ● guest-checkout 4s │  6    await page.goto('/products')              │                           │
│ ○ wishlist-add      │  7    await page.locator('[data-sku="A1"]')    │  [Sim, gerar] [Editar]   │
│ ○ wishlist-remove   │  8      .click()                                │                           │
│ ● mobile-nav ⚠      │  9    await expect(                             │  ─── input do usuário ───│
│ … (35 mais)         │ 10      page.getByRole('status', {             │  ┌─────────────────────┐ │
│                     │ 11        name: /added/i                       │  │ Descreva o cenário  │ │
│ + Novo teste        │ 12      })                                     │  │                     │ │
│                     │ 13    ).toBeVisible()                           │  └─────────────────────┘ │
│                     │ 14  })                                          │                           │
│                     │                                                  │   Contexto:              │
│                     │                                                  │   · teste atual          │
│                     │                                                  │   · último run (fail)    │
│                     │                                                  │   · DOM do último step   │
│                     │                                                  │                           │
│ flakiness 30d       │ ⌘↵ save & run · ⌘/ comentar · ⌘J toggle painel │                           │
│ ▂▂▃▂▅▃▂▁▁▁▂▅█▃▂    │                                                  │                           │
└──────────────────────┴─────────────────────────────────────────────────┴───────────────────────────┘
  260px fixo              flex (min 480px)                                  360px, redimensionável
```

### Aba ativa no painel direito

```
┌ AI · Trace · Steps · Logs ──────────────────┐    ┌ AI · Trace · [ Steps ] · Logs ───────────┐
│                                              │    │                                           │
│  💬 Chat IA                                  │    │  1. ▶ page.goto('/products')      200ms  │
│                                              │    │     ✓ loaded                              │
│                                              │ →  │  2. ▶ locator.click                180ms │
│                                              │    │     ✓ clicked [data-sku="A1"]             │
│                                              │    │  3. ▶ expect.toBeVisible          3800ms │
│                                              │    │     ✗ timed out — role=status não achado │
│                                              │    │        [ver DOM] [ver screenshot]         │
│                                              │    │                                           │
│                                              │    │  ────────────────────────────────────────│
│                                              │    │  💡 IA sugere: o seletor mudou para       │
│                                              │    │  role=alert no deploy-122 (há 2h). Aplicar│
│                                              │    │  patch? [Ver diff] [Aplicar]              │
│                                              │    │                                           │
└──────────────────────────────────────────────┘    └───────────────────────────────────────────┘
```

### Ações inline no editor (toolbar topo direito)

```
▶ Run ▾           — dropdown: Run local · Run contra staging · Run contra prod (disable se viewer)
🕒 Schedule       — overlay cron picker
📋 Duplicate
↻ History         — lista de versões (drawer)
⋯ More
```

### Teclas da tela

| Atalho | Ação |
|---|---|
| `⌘S` | Salvar (sem run) |
| `⌘↵` | Salvar + rodar |
| `⌘/` | Comentar linha |
| `⌘J` | Toggle painel direito |
| `⌘K` | Command palette |
| `⌘.` | Focar input de prompt IA |

## 3. Estados e variações da tela de editor

### Empty state (projeto sem testes)

```
┌──────────────────────────────────────────────────────────────┐
│                                                                │
│                       🧪                                        │
│                                                                │
│          Ainda não há testes neste projeto                    │
│                                                                │
│    Comece de uma das três formas:                              │
│                                                                │
│   ┌──────────────┐  ┌────────────────┐  ┌─────────────────┐   │
│   │  Gerar com   │  │   Importar     │  │   Começar       │   │
│   │  IA a partir │  │   arquivo      │  │   do zero       │   │
│   │  de uma URL  │  │   .spec.ts     │  │                 │   │
│   └──────────────┘  └────────────────┘  └─────────────────┘   │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

### Run em progresso (barra superior fica animada)

```
┌──────────────────────────────────────────────────────────────┐
│ adds-to-cart.spec.ts · ● Rodando em staging  (step 2/3 · 2.4s)│  ← barra teal com shimmer
├──────────────────────────────────────────────────────────────┤
│  … código …                                                  │
```

### Falha recente (destaque vermelho sutil)

```
┌──────────────────────────────────────────────────────────────┐
│ adds-to-cart.spec.ts · ⚠ falhou há 4min · [ver trace] [re-run]│  ← barra rose sutil, não piscando
├──────────────────────────────────────────────────────────────┤
```

## 4. Tela secundária: Tests list (referência rápida)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Tests · checkout-flow                                     + Novo teste   Bulk ▾   ⌕ filtrar   │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ ☐  status   nome                          tags        última run    flakiness    owner       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ ☐  ✓        adds-to-cart                 smoke · cart 2m atrás · 2.1s  ▂▃▂▅█▃     ana.v     │
│ ☐  ⚠        guest-checkout               cart         4m atrás · 4.8s  ▁▁▁▂▁▁     bruno.l   │
│ ☐  ✓        signs-in                     auth         1h atrás · 800ms ▁▁▁▁▁▁     ana.v     │
│ ☐  ✗        mobile-nav                   regression   2h atrás · fail  █▅▃▅█▇     ana.v     │
│ ☐  ○        resets-password              auth         1d atrás · —     ▁▁▁▁▁▁     carla.s   │
│ …                                                                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1–25 de 42    ⟨ Anterior · Próxima ⟩                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Notas:
- Linhas clicáveis (vai ao editor). Hover mostra preview no drawer direito.
- Status: `✓ verde`, `⚠ amarelo (flaky)`, `✗ vermelho`, `○ nunca rodado`, `● azul` (em execução)
- Flakiness é um sparkline dos últimos 14 runs.
- Sem `Actions ▾` por linha — menos poluição. Tudo via bulk ou drawer.

## 5. Mobile (v1.0, não prioritário)

No celular mostramos apenas **consumo** (ver runs, aprovar, compartilhar).
Editor fica "indisponível — abra no desktop". Isso é bom: reforça que a
ferramenta de autoria é séria.

```
┌──────────────────────────┐
│ k-veritas ≡         👤    │
├──────────────────────────┤
│  checkout-flow           │
│  ⚠ 3 falhas nas últimas  │
│  24h                      │
│                           │
│  Runs recentes           │
│  ─────────────           │
│  ✗ guest-checkout  now   │
│  ✓ adds-to-cart   4m     │
│  ✓ mobile-nav    12m     │
│  …                        │
│                           │
└──────────────────────────┘
```

## 6. Próximo passo tangível

Antes de implementar, decidir:

1. **Split panels: `react-resizable-panels` (já no template) ou custom?**
   Recomendo o primeiro — já está instalado, funciona bem com Tailwind.
2. **Editor de código: `@monaco-editor/react` ou `CodeMirror 6`?**
   Monaco é a escolha óbvia para gente que vem de VSCode (90% de QA). Custa
   ~3MB. Carregar via dynamic import em route-level.
3. **Run streaming: SSE ou WebSocket?**
   SSE basta (fluxo server→client, sem comando bidirecional). Simplifica
   deploy em Fluid Compute da Vercel.

Depois disso, a sequência de implementação da Fase 2 fica:

1. Modelo de dados (`projects`, `tests`, `test_versions`, `runs`, `run_steps`, `run_artifacts`)
2. APIs CRUD de projects + tests (sem IA ainda)
3. Shell + sidebar + topbar + command palette (sem content específico)
4. Lista de projetos + wizard de criação (sem IA, URL manual)
5. Lista de testes + editor Monaco (sem IA, edita código cru)
6. Run engine + SSE (pode começar mockado, depois plugar Playwright)
7. Painel IA no editor (chat + generate-test + fix-failure)

Cada item ~1 a 3 dias. Total ~3 semanas até uma fase 2 apresentável.
