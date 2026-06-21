#!/bin/sh
# Körs vid containerstart. Skriver /etc/nginx/conf.d/https.conf
# om SSL-certifikat finns — annars lämnas filen tom.
set -e

CERT=/etc/nginx/certs/cert.pem
KEY=/etc/nginx/certs/key.pem
HTTPS_CONF=/etc/nginx/conf.d/https.conf

if [ -f "$CERT" ] && [ -f "$KEY" ]; then
    echo "[nginx-setup] Certifikat hittat — aktiverar HTTPS på port 443"
    cat > "$HTTPS_CONF" << 'EOF'
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
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass         http://backend:3001;
        proxy_http_version 1.1;
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF
else
    echo "[nginx-setup] Inget certifikat — kör HTTP only (port 80)"
    # Lämna https.conf tom (nginx ignorerar tomma filer via include)
    : > "$HTTPS_CONF"
fi
