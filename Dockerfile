FROM node:26-alpine AS backend-dependencies
WORKDIR /app
RUN apk add --no-cache openssl
RUN npm install --global pnpm@11.25.0 --quiet

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc .pnpm-only-built-deps.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
# Keep the backend toolchain, including the lockfile-pinned Prisma migration CLI.
RUN pnpm install --frozen-lockfile --filter @ghcarpool/backend...

FROM backend-dependencies AS builder
RUN pnpm install --frozen-lockfile --filter @ghcarpool/frontend...
COPY packages/backend ./packages/backend
COPY packages/frontend ./packages/frontend

ARG VITE_GOOGLE_AUTH_ENABLED=false
RUN VITE_API_URL=/api/v1 VITE_GOOGLE_AUTH_ENABLED="$VITE_GOOGLE_AUTH_ENABLED" \
    pnpm --filter @ghcarpool/frontend run build
RUN pnpm --filter @ghcarpool/backend run build

FROM node:26-alpine AS runtime
WORKDIR /app/packages/backend
ENV NODE_ENV=production PORT=3001 RUN_MIGRATIONS=false
RUN apk add --no-cache openssl

COPY --from=backend-dependencies /app/node_modules /app/node_modules
COPY --from=backend-dependencies /app/packages/backend/node_modules ./node_modules
COPY --from=backend-dependencies /app/packages/backend/package.json ./package.json
COPY --from=builder /app/packages/backend/dist ./dist
COPY --from=builder /app/packages/backend/scripts/migrate-from-firestore.ts ./scripts/migrate-from-firestore.ts
COPY --from=builder /app/packages/backend/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/packages/backend/src/lib/recurrence.ts ./src/lib/recurrence.ts
COPY --from=builder /app/packages/backend/prisma ./prisma
COPY --from=builder /app/packages/backend/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/packages/frontend/dist /app/packages/frontend/dist
COPY --chmod=755 packages/backend/docker-entrypoint.sh /docker-entrypoint.sh

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
