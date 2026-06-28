# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:26-alpine AS builder
WORKDIR /app

# pnpm + uppgradera bundlad npm så att "new major version"-varningen försvinner
RUN corepack enable && corepack prepare pnpm@latest --activate \
 && npm install -g npm@latest --quiet

# OpenSSL krävs av Prisma på Alpine
RUN apk add --no-cache openssl

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
FROM node:26-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# OpenSSL krävs av Prisma på Alpine
RUN apk add --no-cache openssl

RUN corepack enable && corepack prepare pnpm@latest --activate \
 && npm install -g npm@latest --quiet

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/

# Only production deps
RUN pnpm install --frozen-lockfile --prod --filter @ghcarpool/backend...

# Compiled output + prisma schema + config (needed for migrations at startup)
COPY --from=builder /app/packages/backend/dist          ./packages/backend/dist
COPY --from=builder /app/packages/backend/prisma        ./packages/backend/prisma
COPY --from=builder /app/packages/backend/prisma.config.ts ./packages/backend/prisma.config.ts
COPY --from=builder /app/node_modules/.pnpm              ./node_modules/.pnpm
# Prisma generated client lives inside node_modules
COPY --from=builder /app/packages/backend/node_modules  ./packages/backend/node_modules

COPY packages/backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
