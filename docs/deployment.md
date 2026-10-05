# DigitalOcean deployment

TripDock runs as separate Node web, API and PostgreSQL containers on the existing
Droplet. Host Nginx serves `https://tripdock.saboya.net`, proxies `/graphql` and
`/voice/session` to `127.0.0.1:4040`, and sends other requests to the frontend at
`127.0.0.1:3040`. Both container ports are published only on host loopback.
PostgreSQL has no published port and owns data in the independent
`tripdock-production_postgres_data` volume. Other hosted applications are separate.

This is a publicly accessible personal installation with no login, as requested
by its owner. Anyone who can reach it can read and mutate trips and invoke the
configured AI endpoints. A private installation can add an access gate at Nginx
or Cloudflare without introducing application accounts.

## Files and configuration

- `docker/Dockerfile`: pinned Node 22.23.2 / pnpm 11.19.0, deterministic verification,
  separate API and web images. The API image includes compiled migrations and only
  production dependencies. Vinext's Node runtime retains its runtime packages.
- `.dockerignore`: excludes secrets, dependencies and local build outputs.
- `compose.production.yaml`: isolated project, persistent PostgreSQL, one-shot
  migration service, application healthchecks, restart policies and bounded logs.
- `deployment/.env.example`: sanitized deployment settings. Copy to the ignored
  `deployment/.env` on the server and restrict its permissions to the operator.
- `deployment/nginx.conf.template`: dedicated hostname; API responses are never
  cached. Replace `__HOSTNAME__` after provisioning the certificate.
- `deployment/backup.sh`: daily custom-format PostgreSQL dump in
  `/srv/tripdock-backups`. Copy backups off the Droplet for disaster recovery;
  local backups alone do not survive losing the Droplet. No automatic purge.

`POSTGRES_PASSWORD` must be a newly generated URL-safe random password, for
example `openssl rand -hex 32`. Keep the password stable when updating existing
data. `PUBLIC_ORIGIN` is `https://tripdock.saboya.net` and `TRIPDOCK_RELEASE`
identifies the exact Git commit. Changing the public origin requires rebuilding
the web image, because the GraphQL URL is a public build-time setting.

`OPENAI_API_KEY` and `OPENAI_MODEL` are optional, server-only environment values.
Use the application's existing evaluated model. Manual editing works without
them. Never place keys in build arguments or `NEXT_PUBLIC_*` variables.

The API still binds to `127.0.0.1` in local development; containers explicitly set
`API_HOST=0.0.0.0`. `TRIPDOCK_WEB_RUNTIME=node` omits Workers/Sites plugins from
the container build. The existing local preview profile remains the default.

## Initial installation

1. Fetch GitHub and select the reviewed deployment commit, including the
   destination-first creation commit. Keep unrelated checkouts and files intact.
2. Stage only tracked source under `/srv/tripdock` and configure its ignored
   environment file. No development databases or browser data are imported.
3. Build and verify before starting the application:

   ```sh
   docker build --target verify -f docker/Dockerfile .
   docker compose --parallel 1 --env-file deployment/.env -f compose.production.yaml build
   docker compose --env-file deployment/.env -f compose.production.yaml up -d --wait postgres api web
   ```

   Compose applies pending migrations once after PostgreSQL is healthy and before
   starting the API. A migration failure blocks application startup. It never
   resets or seeds PostgreSQL. Do not use `down --volumes`.
4. In Cloudflare, add a proxied A record `tripdock` pointing to `162.243.91.97`.
   Bootstrap an HTTP-only Nginx hostname with the ACME challenge directory, then
   issue the certificate:

   ```sh
   /opt/pocket-certbot/bin/certbot certonly --webroot \
     -w /var/www/tripdock-acme -d tripdock.saboya.net --cert-name tripdock
   ```

   Install the complete Nginx template, run `nginx -t`, then reload Nginx. Use
   Cloudflare Full (strict) encryption. The existing certbot renewal timer invokes
   `certbot renew`; configure a deploy hook to validate and reload Nginx when
   certificates renew. Avoid changing other domains' SSL settings.
5. Verify HTTPS, frontend hydration, the empty trip query, a synthetic
   create/read/delete flow and container health. Do not call billed AI tests.
6. Schedule `sh /srv/tripdock/deployment/backup.sh` daily via a dedicated systemd
   service/timer and run it once. Verify the dump using `pg_restore --list`.

## Updates and recovery

Fetch the reviewed release from GitHub into a clean staging checkout; never
overwrite the ignored server environment file. Run the deterministic gate and
build the new versioned images first. Take a database backup, copy only intended
source, set `TRIPDOCK_RELEASE`, then recreate this Compose project. Keep previous
image tags and record the previous source commit for application rollback.

Schema changes require a reviewed additive migration and a compatible recovery
plan. Rolling back an application image does not undo SQL migrations. Do not
restore an older database over live trip data to roll back application code.

Useful operator commands:

```sh
cd /srv/tripdock
docker compose --env-file deployment/.env -f compose.production.yaml ps
docker compose --env-file deployment/.env -f compose.production.yaml logs --tail=100 api web migrate
sh deployment/backup.sh
docker compose --env-file deployment/.env -f compose.production.yaml exec -T postgres \
  pg_restore --list < /srv/tripdock-backups/SELECTED.dump
```

Restore only into a separately provisioned recovery database first. Inspect the
recovered trip/packing records before deciding whether to replace live data.
