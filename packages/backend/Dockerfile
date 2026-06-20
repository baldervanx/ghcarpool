# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Workspace manifest files first (better layer cache)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/

# Install only backend deps (no frontend)
RUN pnpm install --frozen-lockfile --filter @ghcarpool/backend...

# Source
COPY packages/backend ./packages/backend

# Generate Prisma client + compile TypeScript
RUN pnpm --filter @ghcarpool/backend exec prisma generate
RUN pnpm --filter @ghcarpool/backend run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/

# Only production deps
RUN pnpm install --frozen-lockfile --prod --filter @ghcarpool/backend...

# Compiled output + prisma schema (needed for migrations at startup)
COPY --from=builder /app/packages/backend/dist          ./packages/backend/dist
COPY --from=builder /app/packages/backend/prisma        ./packages/backend/prisma
COPY --from=builder /app/node_modules/.pnpm              ./node_modules/.pnpm
# Prisma generated client lives inside node_modules
COPY --from=builder /app/packages/backend/node_modules  ./packages/backend/node_modules

COPY packages/backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
