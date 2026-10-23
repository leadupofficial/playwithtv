#!/bin/sh
# Starts the hub and the web app on the home network over HTTPS (self-signed) so phones can use motion sensors.
cd "$(dirname "$0")/.."
mkdir -p .run
IP=${IP:-$(ipconfig getifaddr en0)}
PORT=8080 PUBLIC_URL=https://$IP:5173 ALLOWED_ORIGINS=https://$IP:5173,https://localhost:5173 ADMIN_TOKEN=${ADMIN_TOKEN:-$(openssl rand -hex 16)} \
  nohup pnpm --filter @scp/server start > .run/server.log 2>&1 &
HTTPS=1 nohup pnpm --filter @scp/web dev > .run/web.log 2>&1 &
echo "TV:    https://$IP:5173/tv"
echo "Phone: https://$IP:5173/join"
