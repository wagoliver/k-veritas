# Mapa de rotas — k-veritas

Documento de referência para a arquitetura de navegação do SaaS. Define:
todas as URLs previstas, a qual contexto pertencem, quem pode acessar e
em qual fase serão entregues.

> Convenção: todas as rotas de página são prefixadas por `/[locale]`
> (`pt-BR` ou `en-US`). Omitido nas tabelas para brevidade.

## 1. Modelo de acesso (RBAC resumido)

Papéis são definidos **no nível da organização** e herdados pelos projetos.
Projetos podem, opcionalmente, ter overrides (não-v1).

| Papel | Escopo | Pode |
|---|---|---|
| `owner` | Org | Tudo, incluindo billing e deletar org |
| `admin` | Org | Gerir membros, integrations, todos os projetos (sem billing/delete org) |
| `editor` | Projeto | Criar/editar/deletar testes, envs, rodar, ver relatórios |
| `viewer` | Projeto | Ler tudo, rodar (opcional por setting), não edita |
| `anon` | — | Só rotas de auth públicas |

`session.mfaLevel` é ortogonal: toda rota autenticada exige `mfa` quando o
usuário tem MFA configurado, senão `none` é aceito.

## 2. Rotas de sistema e auth (Fase 1 — já entregues)

| Rota | Acesso | Propósito |
|---|---|---|
| `/` | redirect | `anon → /login`, `authed → /projects` |
| `/login` | anon | E-mail + senha |
| `/register` | anon | Criação de conta |
| `/forgot-password` | anon | Solicita link de reset |
| `/reset-password` | anon (com token) | Define nova senha |
| `/mfa/verify` | authed (mfaLevel=none) | Segundo fator após login |
| `/mfa/enroll` | authed | Configura TOTP (pode ser forçado em v1) |

### API auth (Fase 1)

| Método | Rota | Acesso | Propósito |
|---|---|---|---|
| POST | `/api/auth/register` | anon | Cria conta |
| POST | `/api/auth/login` | anon | Inicia sessão (gera mfa challenge se houver fator) |
| POST | `/api/auth/logout` | authed | Encerra sessão atual |
| POST | `/api/auth/refresh` | cookie | Rotaciona refresh token |
| GET/POST | `/api/auth/mfa/enroll` | authed | Inicia / confirma enrollment |
| POST | `/api/auth/mfa/verify` | authed (mfaLevel=none) | Resolve challenge |
| POST | `/api/auth/password-reset/request` | anon | Envia link (resposta 204 sempre) |
| POST | `/api/auth/password-reset/confirm` | anon (com token) | Aplica nova senha |

## 3. Rotas da aplicação (Fase 2 em diante)

### Home / navegação-âncora

| Rota | Acesso | Propósito | Fase |
|---|---|---|---|
| `/projects` | authed | Lista de projetos + botão criar (home pós-login) | v0.1 |
| `/projects/new` | editor+ | Wizard de novo projeto (URL → browsers → primeiro teste via IA) | v0.1 |
| `/projects/[projectId]` | viewer+ | Overview do projeto: últimas runs, flakiness, saúde | v0.2 |

### Projeto — áreas principais

| Rota | Acesso | Propósito | Fase |
|---|---|---|---|
| `/projects/[p]/tests` | viewer+ | Lista densa de testes (filtros + bulk actions) | v0.1 |
| `/projects/[p]/tests/new` | editor+ | Novo teste (IA ou branco) | v0.1 |
| `/projects/[p]/tests/[t]` | viewer+ | Editor (split: lista · código · IA/trace) | v0.1 |
| `/projects/[p]/tests/[t]/history` | viewer+ | Diff de versões do teste | v0.2 |
| `/projects/[p]/runs` | viewer+ | Histórico de execuções (filtros por status, env, tag, intervalo) | v0.1 |
| `/projects/[p]/runs/[r]` | viewer+ | Detalhe de run: timeline, trace, artifacts, re-run | v0.1 |
| `/projects/[p]/runs/[r]/artifacts/[a]` | viewer+ | Download direto (auth'd) | v0.1 |
| `/projects/[p]/schedules` | editor+ | Agendamentos cron (natural language) | v0.2 |
| `/projects/[p]/environments` | editor+ | URLs, fixtures, secrets, credenciais | v0.2 |
| `/projects/[p]/reports` | viewer+ | Flakiness, tempo, coverage, trends | v0.3 |
| `/projects/[p]/settings` | admin+ | Integrations (GitHub, Slack, Jira), webhooks, API keys, danger zone | v0.2 |

### Organização / time / conta

| Rota | Acesso | Propósito | Fase |
|---|---|---|---|
| `/activity` | authed | Feed global de eventos (quem fez o quê) | v0.3 |
| `/team` | admin+ | Membros, convites, papéis | v0.2 |
| `/team/billing` | owner | Planos, faturas, seats | v1.0 |
| `/settings/profile` | authed | Nome, avatar, idioma | v0.1 |
| `/settings/security` | authed | Senha, MFA, sessões ativas, backup codes | v0.1 |
| `/settings/api-keys` | authed | Tokens pessoais (CI, CLI) | v0.2 |

### Sistema

| Rota | Acesso | Propósito |
|---|---|---|
| `/404` | todos | Not found |
| `/403` | todos | Sem permissão |
| `/500` | todos | Erro inesperado |
| `/status` | todos | Health do app (opcional, fase 3) |

## 4. API de produto (Fase 2 em diante)

Todas as rotas exigem `Authorization: Bearer <accessToken>` **ou** cookie
de sessão. Erros em RFC 7807 (`application/problem+json`).

### Projects

| Método | Rota | Acesso | Propósito |
|---|---|---|---|
| GET | `/api/projects` | authed | Lista projetos da org |
| POST | `/api/projects` | admin+ | Cria projeto |
| GET | `/api/projects/[p]` | viewer+ | Detalhe |
| PATCH | `/api/projects/[p]` | admin+ | Atualiza metadata |
| DELETE | `/api/projects/[p]` | admin+ | Exclui (soft delete, drain de runs) |

### Tests

| Método | Rota | Acesso | Propósito |
|---|---|---|---|
| GET | `/api/projects/[p]/tests` | viewer+ | Lista com filtros |
| POST | `/api/projects/[p]/tests` | editor+ | Cria teste |
| GET | `/api/tests/[t]` | viewer+ | Detalhe + código atual |
| PATCH | `/api/tests/[t]` | editor+ | Salva nova versão |
| DELETE | `/api/tests/[t]` | editor+ | Remove |
| GET | `/api/tests/[t]/versions` | viewer+ | Histórico |

### Runs

| Método | Rota | Acesso | Propósito |
|---|---|---|---|
| GET | `/api/projects/[p]/runs` | viewer+ | Lista com filtros |
| POST | `/api/projects/[p]/runs` | editor+ (viewer+ opcional) | Dispara run (subset de testes, env) |
| GET | `/api/runs/[r]` | viewer+ | Detalhe |
| GET | `/api/runs/[r]/events` | viewer+ | **SSE streaming** de steps/logs |
| GET | `/api/runs/[r]/artifacts/[a]` | viewer+ | Download proxy |
| POST | `/api/runs/[r]/rerun` | editor+ | Re-executa (todos ou só falhas) |
| POST | `/api/runs/[r]/cancel` | editor+ | Interrompe |

### AI

| Método | Rota | Acesso | Propósito |
|---|---|---|---|
| POST | `/api/ai/generate-test` | editor+ | **Streaming**: prompt → código Playwright |
| POST | `/api/ai/fix-failure` | editor+ | **Streaming**: trace+código → patch sugerido |
| POST | `/api/ai/chat` | editor+ | **Streaming**: sessão de chat contextualizada |

### Integrations & webhooks

| Método | Rota | Acesso | Propósito |
|---|---|---|---|
| GET | `/api/projects/[p]/integrations` | admin+ | Lista |
| POST | `/api/projects/[p]/integrations/[kind]` | admin+ | Conecta GitHub/Slack/Jira |
| POST | `/api/hooks/[kind]/[token]` | pub (token) | Recebe webhook externo |

## 5. Redirects e regras globais

1. `/` sempre redireciona para `/{defaultLocale}/...` (middleware de i18n)
2. Sem sessão em rota autenticada → `/login?next=<original>`
3. Com sessão mas MFA pendente → `/mfa/verify`
4. Sem permissão → `/403` com mensagem clara (não mascarar como 404)
5. Rota inexistente → `/404` custom
6. Troca de locale preserva pathname (`Link` do next-intl)

## 6. Acesso visual (RBAC na UI)

- **Viewer** nunca vê botões de mutação — eles são ocultados, não apenas
  desabilitados ou bloqueados via 403.
- **Ações irreversíveis** (deletar, mudar env de prod, revogar sessão)
  exigem modal de confirmação com "digitar o nome" quando for projeto/org.
- **Estado de sessão stale** (token expirado em background) dispara toast
  silencioso + refresh automático; não derruba a pessoa para o login a
  menos que o refresh falhe.

## 7. Convenções de URL

- IDs são UUIDv4 **ou** slugs estáveis (projeto/teste). Preferir slug em
  URL, UUID interno. Ex: `/projects/checkout-flow/tests/adds-to-cart`.
- Listas leem filtros de **query string** (`?status=failed&env=staging`) —
  permite compartilhar link e bookmarkar.
- Nunca codificar filtro de permissão na URL (ex: `?as=admin`). Sempre
  derivar do server.
