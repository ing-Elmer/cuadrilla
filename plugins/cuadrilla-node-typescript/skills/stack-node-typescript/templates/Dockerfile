# syntax=docker/dockerfile:1
# Production image for a cuadrilla node-typescript backend.
# Keep NODE_VERSION equal to .nvmrc (the LTS line pinned by the project).
ARG NODE_VERSION=24

# ---- build: install all deps from the lockfile and compile TypeScript ----
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- deps: production dependencies only ----
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Native modules (argon2) need their install scripts; nothing else runs at install time.
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: compiled code + prod deps, non-root, no npm in the start command ----
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
# Platforms (Railway, Fly, Kubernetes…) probe GET /health; the app answers it with SELECT 1.
# node directly (not npm start) so SIGTERM reaches the process and graceful shutdown runs.
CMD ["node", "--enable-source-maps", "dist/main.js"]
