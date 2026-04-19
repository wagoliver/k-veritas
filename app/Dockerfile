# syntax=docker/dockerfile:1.7

# ────────────────────────────────────────────────
# Base: Node 24 LTS Alpine + pnpm via Corepack
# ────────────────────────────────────────────────
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ────────────────────────────────────────────────
# deps: instala todas as dependências (incl. dev)
# Cache: rebuild só quando package.json / lockfile mudam.
# ────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prefer-frozen-lockfile

# ────────────────────────────────────────────────
# source: deps + código-fonte. Usado pelo service
# `migrate` para rodar drizzle-kit e clickhouse-migrate.
# ────────────────────────────────────────────────
FROM deps AS source
COPY . .

# ────────────────────────────────────────────────
# builder: compila a aplicação Next.js (standalone)
# ────────────────────────────────────────────────
FROM source AS builder
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
RUN pnpm build

# ────────────────────────────────────────────────
# runtime: imagem mínima de produção
# Copia apenas o bundle standalone, assets estáticos
# e o binário nativo do @node-rs/argon2 (server-external).
# ────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nodejs && \
    adduser  -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# @node-rs/argon2 é marcado como serverExternalPackages
# e precisa estar presente em node_modules no runtime.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@node-rs ./node_modules/@node-rs

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
