# syntax=docker/dockerfile:1.7

FROM node:24.17.0-bookworm-slim AS web-build

WORKDIR /workspace

RUN npm install --global corepack@latest \
    && corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile --filter @nhdp/web...

COPY tsconfig.base.json ./
COPY apps/web apps/web

RUN pnpm --filter @nhdp/web build

FROM caddy:2.11.4-alpine

COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /workspace/apps/web/dist /srv
