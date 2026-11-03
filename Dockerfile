# ─────────────────────────────────────────────
# Parcel Yatra — Production Dockerfile
# Target: Railway.app (or any Docker host)
# Build: multi-stage, Node 22 Alpine
# ─────────────────────────────────────────────

# ── Stage 1: deps ──────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Install all workspace deps (production + dev needed for build)
COPY package.json package-lock.json ./
COPY packages/domain/package.json ./packages/domain/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY tsconfig.base.json ./

RUN npm ci --ignore-scripts

# ── Stage 2: build ─────────────────────────────
FROM deps AS builder
WORKDIR /app

# Domain package
COPY packages/domain ./packages/domain

# API source
COPY apps/api ./apps/api

# Web source
COPY apps/web ./apps/web

# Build domain (tsc declarations)
RUN npm run typecheck -w @py/domain || true

# Build API — esbuild bundles to dist/index.js
RUN npm run build -w @py/api

# Build web — vite builds to apps/web/dist
RUN npm run build -w @py/web

# ── Stage 3: api runner ────────────────────────
FROM node:22-alpine AS api
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Only copy the bundled API output and production node_modules
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/src/db/schema.sql ./src/db/schema.sql
COPY --from=builder /app/apps/api/migrations ./migrations
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

# Non-root user for security
RUN addgroup -S pyatra && adduser -S pyatra -G pyatra
RUN mkdir -p /app/data && chown pyatra:pyatra /app/data
USER pyatra

# Railway sets $PORT automatically; we honour it.
EXPOSE 3000

# Apply migrations then start
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
