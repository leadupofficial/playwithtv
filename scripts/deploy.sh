#!/bin/sh
# Deploys this checkout to the maintainers' server. Every server detail (SSH host, remote folder) lives in a
# private ops folder outside this repository; nothing about the server is committed here.
#   PLAYWITHTV_OPS   folder with deploy.env (default: ~/playwithtv-ops)
#   deploy.env       DEPLOY_HOST=<ssh host alias>  DEPLOY_DIR=<remote folder>  HEALTH_URL=<url checked on the server>
set -eu
OPS="${PLAYWITHTV_OPS:-$HOME/playwithtv-ops}"
[ -f "$OPS/deploy.env" ] || { echo "No $OPS/deploy.env (private ops folder). Only maintainers deploy." >&2; exit 1; }
. "$OPS/deploy.env"
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ]; then echo "Commit or stash your changes first: deploys must match a commit." >&2; exit 1; fi
REV=$(git rev-parse --short HEAD)
echo "Deploying $REV to $DEPLOY_HOST:$DEPLOY_DIR"
rsync -az --exclude node_modules --exclude dist --exclude .env --exclude .git --exclude test-results \
  --exclude playwright-report --exclude .run --exclude .certs --exclude apps/tv-android ./ "$DEPLOY_HOST:$DEPLOY_DIR/"
ssh -o BatchMode=yes "$DEPLOY_HOST" "cd '$DEPLOY_DIR/deploy' && echo $REV > ../.deployed-commit && docker compose up -d --build hub \
  && for i in \$(seq 1 45); do curl -sf '$HEALTH_URL' >/dev/null && echo 'healthy' && exit 0; sleep 2; done; echo 'NOT HEALTHY' >&2; exit 1"
