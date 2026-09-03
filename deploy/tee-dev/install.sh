#!/usr/bin/env bash
# One-time preparation of tee-dev for the POS stack. Idempotent. Run ON the server:
#   scp -i ~/.ssh/spark_tunnel deploy/tee-dev/install.sh tee@100.122.174.19:/tmp/ && ssh ubuntu-server 'SUDO_PW=... bash /tmp/install.sh'
# Rules from SSH-LOCAL-UBUNTU-SERVER.md: sudo has no TTY → password via stdin (`echo "$PW" | sudo -S`), never with a heredoc,
# never pipe data into `sudo -S tee`; write files to /tmp first then `sudo cp`.
set -euo pipefail
BASE=/data/pos
WEB_PORT=${WEB_PORT:-3010}
PW=${SUDO_PW:-}

s() { if [ -n "$PW" ]; then echo "$PW" | sudo -S "$@" 2>/dev/null; else sudo "$@"; fi; }

echo "== directories"
mkdir -p "$BASE"/{src,pgdata,legacy,backups,appdata}
# the api image runs as uid 10001, so the volume it writes to (in-app backups and uploaded legacy
# dumps) must belong to that uid. Done through docker so no sudo is needed.
docker run --rm -v "$BASE/appdata:/d" alpine:3.20 chown -R 10001:10001 /d
ls -ld "$BASE" "$BASE/appdata"

echo "== docker"
if ! command -v docker >/dev/null; then
  echo "docker missing → installing docker.io + compose plugin"
  s apt-get update -qq
  s apt-get install -y -qq docker.io docker-compose-v2
  s systemctl enable --now docker
fi
docker --version
docker compose version
if ! id -nG "$USER" | grep -qw docker; then
  echo "adding $USER to docker group (log out and back in afterwards)"
  s usermod -aG docker "$USER"
fi

echo "== firewall (ufw allows only 22 by default)"
if s ufw status | grep -q "Status: active"; then
  s ufw allow "${WEB_PORT}/tcp" >/dev/null && echo "ufw: allowed ${WEB_PORT}/tcp"
fi

echo "== env file"
if [ ! -f "$BASE/.env" ]; then
  cp "$BASE/src/deploy/.env.example" "$BASE/.env" 2>/dev/null || true
  if [ -f "$BASE/.env" ]; then
    sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 16)/" "$BASE/.env"
    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" "$BASE/.env"
    sed -i "s/^JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$(openssl rand -hex 32)/" "$BASE/.env"
    sed -i "s/^PLATFORM_ADMIN_PASSWORD=.*/PLATFORM_ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '\/+=')/" "$BASE/.env"
    chmod 600 "$BASE/.env"
    echo "created $BASE/.env with random secrets — platform admin password:"; grep '^PLATFORM_ADMIN_PASSWORD' "$BASE/.env"
  else
    echo "!! $BASE/src not deployed yet; run deploy.sh first, then re-run install.sh to create .env"
  fi
else
  echo "$BASE/.env exists (kept)"
fi
echo "== done"
