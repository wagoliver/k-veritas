# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/playwright:v1.49.0-noble

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

RUN mkdir -p /data && chown -R pwuser:pwuser /data /app
USER pwuser

CMD ["node", "--experimental-strip-types", "src/index.ts"]
