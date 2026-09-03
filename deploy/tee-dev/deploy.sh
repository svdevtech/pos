#!/usr/bin/env bash
# Ship the source tree to tee-dev and (re)build the stack. Run from the repo root on the dev machine (Git Bash):
#   bash deploy/tee-dev/deploy.sh            # tar over ssh (fast, ~15 MB/s) + docker compose up -d --build
#   bash deploy/tee-dev/deploy.sh --no-build # only sync files
# Uses the ssh alias `ubuntu-server` (Tailscale 100.122.174.19) from ~/.ssh/config.
set -euo pipefail
HOST=${POS_SSH_HOST:-ubuntu-server}
BASE=/data/pos
BUILD=1
[ "${1:-}" = "--no-build" ] && BUILD=0
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
VERSION=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)

echo "== sync $ROOT → $HOST:$BASE/src (version $VERSION)"
ssh "$HOST" "mkdir -p $BASE/src $BASE/legacy $BASE/backups $BASE/pgdata"
tar -C "$ROOT" -czf - \
  --exclude=node_modules --exclude=.git --exclude=.next --exclude=bin --exclude=legacy-dump --exclude=legacy-dump2 \
  --exclude='*.mdb' --exclude='.env' --exclude='backend/.env' --exclude='frontend/.env*' \
  backend frontend deploy docs tools README.md CLAUDE.md .gitignore 2>/dev/null \
  | ssh "$HOST" "tar -xzf - -C $BASE/src"
ssh "$HOST" "echo $VERSION > $BASE/src/VERSION"

if [ ! -f "$ROOT/deploy/.env.example" ]; then echo "missing deploy/.env.example"; exit 1; fi
ssh "$HOST" "[ -f $BASE/.env ] || { echo '!! $BASE/.env missing — run install.sh on the server first'; exit 1; }"

if [ "$BUILD" = "1" ]; then
  echo "== docker compose up --build"
  ssh "$HOST" "cd $BASE/src/deploy && VERSION=$VERSION docker compose --env-file $BASE/.env up -d --build --remove-orphans"
  echo "== status"
  ssh "$HOST" "cd $BASE/src/deploy && docker compose --env-file $BASE/.env ps && sleep 5 && curl -fsS http://localhost:\$(grep -E '^API_PORT' $BASE/.env | cut -d= -f2 || echo 8090)/health && echo"
fi
echo "== done. web: http://192.168.1.120:3010  (or http://100.122.174.19:3010 via Tailscale)"
