# web image: build the Vite app, serve static files with non-root nginx. Build context = repository root:
#   docker build -f apps/web/Dockerfile -t vaaniehr/web:local .
# VITE_* values are PUBLIC build-time settings (they end up in the JS bundle). Never pass secrets as build args.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.5-alpine3.24@sha256:56b8272e43a0525f67aed68d1e0794a712d10e3e45a563e118e9a77c817e6f86

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY apps/api-node/package.json apps/api-node/
COPY apps/web/package.json apps/web/
COPY packages/rules/package.json packages/rules/
RUN npm ci -w apps/web --include-workspace-root
COPY tsconfig.base.json ./
COPY apps/web apps/web
ARG VITE_API_BASE_URL=http://localhost:4000
ARG VITE_SIMULATED_DATA_ONLY=true
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} VITE_SIMULATED_DATA_ONLY=${VITE_SIMULATED_DATA_ONLY}
RUN npm run build -w apps/web

FROM ${NGINX_IMAGE} AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
