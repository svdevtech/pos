#!/usr/bin/env bash
# Nightly PostgreSQL dump of the POS database. Cron (as tee): 0 2 * * * /data/pos/src/deploy/tee-dev/backup.sh
set -euo pipefail
BASE=/data/pos
KEEP_DAYS=${KEEP_DAYS:-30}
mkdir -p "$BASE/backups"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BASE/backups/pos-$STAMP.dump"
docker compose -f "$BASE/src/deploy/docker-compose.yml" --env-file "$BASE/.env" exec -T postgres \
  pg_dump -U pos -d pos --format=custom > "$OUT"
gzip -f "$OUT"
find "$BASE/backups" -name 'pos-*.dump.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup written: $OUT.gz"
