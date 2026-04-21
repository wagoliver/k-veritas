# syntax=docker/dockerfile:1.7
#
# Container do serviço `codex`: worker que roda Claude Code CLI sobre
# o código-fonte de um projeto do usuário (clonado de GitHub ou
# extraído de ZIP), importando o resultado no Postgres.
#
# Base `node:22-slim` — imagem slim da família Debian. Alpine (musl)
# dá problema com módulos nativos do Claude Code, por isso não usamos.
# Node 22 é necessário para o flag --experimental-strip-types que roda
# os .ts direto (mesmo padrão do crawler/runner). Node 20 não tem.

FROM node:22-slim

ENV NODE_ENV=production \
    DEBIAN_FRONTEND=noninteractive

# git   — clone de repositórios.
# ca-certificates + openssh-client — HTTPS e SSH para GitHub.
# unzip — fallback se precisarmos extrair zip via shell; mantido
#         mesmo usando adm-zip no Node (debug).
# jq    — utilitário pra inspeção ad hoc do stream JSON.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      openssh-client \
      unzip \
      jq \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Claude Code CLI global — garante o binário `claude` no PATH.
# Instalar como dep local (no package.json) funcionaria, mas deixa o
# binário em /app/node_modules/.bin/claude, que o worker chamaria via
# spawn com path absoluto. Globalmente é mais limpo.
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code@^2.1.114

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# O volume /data é compartilhado com o serviço `app`, que cria diretórios
# como uid 1001. Alinhamos o uid do codex pra escrever sem conflito de
# perms. `usermod` precisa que o user não esteja em uso — OK durante
# build. Mantemos o nome "node".
RUN usermod -u 1001 node && groupmod -g 1001 node && \
    mkdir -p /data /work && chown -R node:node /work /app
USER node

# O worker faz polling em loop; não precisa de healthcheck especial.
CMD ["node", "--experimental-strip-types", "src/index.ts"]
