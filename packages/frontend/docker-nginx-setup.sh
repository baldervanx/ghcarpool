#!/bin/sh
# Körs vid containerstart.
#
# 1. Skriver resolver-IP dynamiskt från /etc/resolv.conf och patchar
#    /etc/nginx/conf.d/default.conf så att nginx inte cachar backend-IP:n.
# 2. Skriver /etc/nginx/conf.d/https.conf om SSL-certifikat finns.
set -e

CONF=/etc/nginx/conf.d/default.conf
HTTPS_CONF=/etc/nginx/conf.d/https.conf
CERT=/etc/nginx/certs/cert.pem
KEY=/etc/nginx/certs/key.pem

# ── 1. Lös resolver-IP dynamiskt ─────────────────────────────────────────────
# Nginx cachar proxy_pass-hostnamnet vid uppstart om ingen resolver anges.
# När backend-kontainern återskapas och får ny IP ger det 502 Bad Gateway.
# Genom att sätta resolver + proxy_pass via variabel re-resolvas DNS per request.

RESOLVER_IP=$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)
if [ -z "$RESOLVER_IP" ]; then
    echo "[nginx-setup] VARNING: kunde inte läsa nameserver ur /etc/resolv.conf — använder 127.0.0.11"
    RESOLVER_IP="127.0.0.11"
fi
echo "[nginx-setup] DNS resolver: $RESOLVER_IP"

# Injicera resolver-direktivet i nginx-konfigen (in-place substitution med sed).
# Filen innehåller platshållaren RESOLVER_PLACEHOLDER skriven av nginx.conf.
sed -i "s|RESOLVER_PLACEHOLDER|${RESOLVER_IP}|g" "$CONF"

# ── 2. HTTPS ──────────────────────────────────────────────────────────────────
if [ -f "$CERT" ] && [ -f "$KEY" ]; then
    echo "[nginx-setup] Certifikat hittat — aktiverar HTTPS på port 443"
    cat > "$HTTPS_CONF" << NGINXEOF
server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     /etc/nginx/certs/cert.pem;
    ssl_certificate_key /etc/nginx/certs/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    resolver ${RESOLVER_IP} valid=10s ipv6=off;
    set \$backend_upstream http://backend:3001;

    location /api/ {
        proxy_pass         \$backend_upstream;
        proxy_http_version 1.1;
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
NGINXEOF
else
    echo "[nginx-setup] Inget certifikat — kör HTTP only (port 80)"
    # Lämna https.conf tom (nginx ignorerar tomma filer via include)
    : > "$HTTPS_CONF"
fi
