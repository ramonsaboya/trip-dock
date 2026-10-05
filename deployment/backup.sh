#!/bin/sh
set -eu
umask 077
cd /srv/tripdock
mkdir -p /srv/tripdock-backups
target="/srv/tripdock-backups/tripdock-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file deployment/.env -f compose.production.yaml exec -T postgres \
  pg_dump -U tripdock -d tripdock --format=custom > "$target.partial"
test -s "$target.partial"
mv "$target.partial" "$target"
echo "TripDock backup completed: $target"
