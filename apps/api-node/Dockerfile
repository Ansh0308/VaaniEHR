# api-node image. Build context = repository root:
#   docker build -f apps/api-node/Dockerfile -t vaaniehr/api-node:local .
# Base image pinned by tag and digest (checked on Docker Hub 2026-10-14). No secrets are copied or baked in:
# configuration arrives as environment variables at run time (see infra/docker-compose.yml).
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

# ---- build: install all deps, compile TypeScript ----
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY apps/api-node/package.json apps/api-node/
COPY apps/web/package.json apps/web/
COPY packages/rules/package.json packages/rules/
RUN npm ci -w apps/api-node --include-workspace-root
COPY tsconfig.base.json ./
COPY apps/api-node apps/api-node
RUN npm run build -w apps/api-node

# ---- deps: production dependencies only ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY apps/api-node/package.json apps/api-node/
COPY apps/web/package.json apps/web/
COPY packages/rules/package.json packages/rules/
RUN mkdir -p apps/api-node/node_modules && npm ci -w apps/api-node --omit=dev

# ---- runtime: non-root, no dev tooling ----
FROM ${NODE_IMAGE} AS runtime
# NODE_ENV is deliberately not set here: the dev auth provider is refused when NODE_ENV=production (config guard).
WORKDIR /repo/apps/api-node
COPY --from=deps /repo/node_modules /repo/node_modules
COPY --from=deps /repo/apps/api-node/node_modules ./node_modules
COPY --from=build /repo/apps/api-node/dist ./dist
COPY apps/api-node/package.json ./package.json
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
