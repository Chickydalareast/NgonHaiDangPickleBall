# syntax=docker/dockerfile:1.7

FROM node:24.17.0-bookworm-slim AS web-build

WORKDIR /workspace

RUN npm install --global pnpm@11.9.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile --filter @nhdp/web...

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web

RUN pnpm --filter @nhdp/contracts build \
    && pnpm --filter @nhdp/web build

FROM caddy:2.11.4-alpine

ARG CADDYFILE=infra/caddy/Caddyfile

COPY ${CADDYFILE} /etc/caddy/Caddyfile
COPY --from=web-build /workspace/apps/web/dist /srv
