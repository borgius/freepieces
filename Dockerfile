# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for freepieces Linux deployment.
# Build stage compiles TypeScript and the admin SPA.
# Runtime stage ships only production deps + compiled output.

# ── Build stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build:admin && pnpm run build:linux

# ── Runtime stage ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist/linux ./dist/linux
COPY --from=builder /app/dist/public ./dist/public

ENV PORT=3000
EXPOSE 3000

# Persist token store and auth state between container restarts
VOLUME ["/app/data"]

CMD ["node", "dist/linux/linux-server.cjs"]
