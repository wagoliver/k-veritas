# syntax=docker/dockerfile:1.7
#
# Container pra rodar OpenCode (sst/opencode) em modo não-interativo
# sobre um diretório de código-fonte montado em /repo.
#
# OBS: a CLI exata do OpenCode evolui rápido. Ao rodar o spike, verifique
# a flag equivalente a "não-interativo + print e sai" na versão instalada
# (atualmente `opencode run <prompt>`). Atualize `entrypoint.sh` se mudar.

FROM node:22-alpine

# ripgrep: algumas tools internas do opencode usam `rg` para buscas.
# git:     alguns fluxos internos do agente precisam.
# curl/jq: úteis no entrypoint.
RUN apk add --no-cache ripgrep git curl jq bash

# Instala o CLI do OpenCode globalmente via npm.
# Pin explícito: troque o @ para o range que você quer testar no spike.
RUN npm install -g opencode-ai@latest

WORKDIR /work

# Dependências do parser (zod). Copiamos só os manifests primeiro pra
# aproveitar cache, depois a pasta inteira.
COPY parser/package.json parser/tsconfig.json ./parser/
RUN cd parser && npm install --no-audit --no-fund

COPY parser ./parser
COPY system-prompt.md ./system-prompt.md
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV ANALYZER_MODEL=anthropic/claude-sonnet-4-5-20250929
ENV RESULTS_DIR=/results

VOLUME ["/repo", "/results"]

ENTRYPOINT ["./entrypoint.sh"]
