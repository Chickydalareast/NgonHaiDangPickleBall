# syntax=docker/dockerfile:1.7

FROM node:24.17.0-bookworm-slim AS base

WORKDIR /workspace

RUN npm install --global corepack@latest \
    && corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

FROM base AS build

RUN pnpm install --frozen-lockfile --filter @nhdp/api...

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api

RUN pnpm --filter @nhdp/contracts build \
    && pnpm --filter @nhdp/api build

FROM base AS production-dependencies

RUN pnpm install --frozen-lockfile --prod --filter @nhdp/api...

FROM node:24.17.0-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=production-dependencies /workspace/node_modules ./node_modules
COPY --from=production-dependencies /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=production-dependencies /workspace/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=production-dependencies /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/drizzle ./apps/api/drizzle

USER node

EXPOSE 3000

CMD ["node", "apps/api/dist/server.js"]
