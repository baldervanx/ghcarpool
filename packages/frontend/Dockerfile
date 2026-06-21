# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/frontend/package.json ./packages/frontend/

RUN pnpm install --frozen-lockfile --filter @ghcarpool/frontend...

COPY packages/frontend ./packages/frontend

ARG VITE_API_URL=/api/v1
ARG VITE_GOOGLE_AUTH_ENABLED=false

RUN VITE_API_URL="$VITE_API_URL" \
    VITE_GOOGLE_AUTH_ENABLED="$VITE_GOOGLE_AUTH_ENABLED" \
    pnpm --filter @ghcarpool/frontend run build

# ── Stage 2: nginx ────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/packages/frontend/dist  /usr/share/nginx/html
COPY packages/frontend/nginx.conf                 /etc/nginx/conf.d/default.conf
COPY packages/frontend/docker-nginx-setup.sh      /docker-nginx-setup.sh
RUN chmod +x /docker-nginx-setup.sh

# Tom https.conf så att nginx inte kraschar på include när cert saknas
RUN touch /etc/nginx/conf.d/https.conf

EXPOSE 80 443

# Entrypoint: lägg till https.conf om cert finns, starta sedan nginx
CMD ["/bin/sh", "-c", "/docker-nginx-setup.sh && nginx -g 'daemon off;'"]
