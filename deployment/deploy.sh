#!/bin/bash
# Executed from the uploaded, immutable release directory on the existing Droplet.
set -euo pipefail
umask 077

release=${1:?Supply the full Git commit SHA}
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA' >&2; exit 1; }
root=/srv/tripdock-releases
directory="$root/$release"
[[ "$(pwd -P)" == "$directory" ]] || { echo 'Unexpected release directory' >&2; exit 1; }
test -r /srv/tripdock/deployment/.env

# Serializes operator invocations as well as GitHub deployments; never interrupts migrations.
exec 9>"$root/deploy.lock"
flock -w 600 9

# Copy, never source or overwrite, the operator's durable server secrets.
cp /srv/tripdock/deployment/.env deployment/release.env
chmod 600 deployment/release.env
export TRIPDOCK_RELEASE="$release"
compose=(docker compose --env-file deployment/release.env -f compose.production.yaml)
gzip -dc images.tar.gz | docker load
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 postgres
sh /srv/tripdock/deployment/backup.sh

# Every release runs its own migration process, even if the old migrate container exited.
# A failed migration leaves the running app in place and blocks the new version.
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" up -d --no-build --no-deps --wait --wait-timeout 180 api web
curl --fail --silent --show-error --retry 3 --retry-delay 5 https://tripdock.saboya.net/ > /dev/null
curl --fail --silent --show-error --retry 3 --retry-delay 5 \
  -H 'content-type: application/json' -d '{"query":"{ trips { id } }"}' \
  https://tripdock.saboya.net/graphql \
  | docker compose --env-file deployment/release.env -f compose.production.yaml exec -T api \
    node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const b=JSON.parse(s);if(b.errors||!Array.isArray(b.data?.trips))process.exit(1)})'

if test -f "$root/current"; then
  if [[ "$(cat "$root/current")" != "$directory" ]]; then
    cp "$root/current" "$root/previous"
  fi
else
  printf '%s\n' /srv/tripdock > "$root/previous"
fi
printf '%s\n' "$directory" > "$root/current.tmp"
mv "$root/current.tmp" "$root/current"
rm -f images.tar.gz source.tar.gz
echo "Deployed TripDock $release"
