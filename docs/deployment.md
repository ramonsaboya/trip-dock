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

Use the continuous delivery pipeline below for normal updates. For manual
updates, fetch the reviewed release from GitHub into a clean staging checkout;
never overwrite the ignored server environment file. Run the deterministic gate
and build new versioned images first. Take a database backup, copy only intended
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

## Continuous delivery

The owner's workflow has two phases. During implementation, agents edit directly
without writing tests or running verification commands; the owner tests manually
and requests iterations. Explicit acceptance (for example, "this is done, do all
the tests and checking") starts final verification and meaningful regression
test writing. Fix failures before committing and pushing to `main`. Experimental
work uses another branch when requested. Unverified work must be labeled as such.
The root and app-level `AGENTS.md` files record this policy.

`.github/workflows/delivery.yaml` runs on pushes, pull requests targeting `main`,
and manual dispatch. It installs the README's pinned tools and runs `pnpm check`,
`pnpm test:postgres` against a disposable CI database, and the browser suite using
Chrome. It never receives provider keys or runs billed AI tests.

Only successful `main` runs build API/web images tagged with the full commit SHA.
The runner transfers those images and a tracked-source archive over verified SSH;
the Droplet needs neither GitHub repository credentials nor a container registry
login. Builds occur on GitHub rather than competing with production on the Droplet.
The origin is fixed to this installation's `https://tripdock.saboya.net`.

### One-time activation

The workflow is inactive until it is committed to GitHub and the SSH settings
below are configured. Creating the local files alone does not activate delivery.

1. On the existing Droplet, choose a dedicated deployment SSH user. It needs Docker
   access and write permission to `/srv/tripdock-releases` and
   `/srv/tripdock-backups`, plus read permission to
   `/srv/tripdock/deployment/.env`. Docker access grants powerful host access;
   use a deployment-specific key, never a personal SSH key. Keep the existing
   Compose installation, environment file, database volume, Nginx and backup timer.
   Install Docker Compose v2, Bash, `flock`, gzip, tar and curl if missing.
   Create the release directory with mode `700` owned by the deployment user.
   The runner uses native Linux images; the existing Droplet must be x86-64.
2. Generate a dedicated Ed25519 key using the operator's secure key management.
   Add its public key to the user's `authorized_keys`, with forwarding disabled
   using the `restrict` option. The pipeline needs file transfer and remote shell
   commands, so do not configure a forced command that blocks these operations.
3. In the repository's **Settings → Environments**, create `production`. Restrict
   deployment branches to `main`. Leave required reviewers and wait timers off
   to preserve the requested automatic deployment after checks pass.
4. Configure these environment variables and secrets:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Variable | `DEPLOY_HOST` | `162.243.91.97` |
   | Variable | `DEPLOY_USER` | The deployment SSH username |
   | Variable | `DEPLOY_PORT` | SSH port; defaults to `22` |
   | Secret | `DEPLOY_SSH_KEY` | The dedicated private key, without a passphrase |
   | Secret | `DEPLOY_KNOWN_HOSTS` | Verified OpenSSH known-hosts entry for this host/port |

   Verify the SSH host-key fingerprint through the Droplet console or another
   already-trusted channel before saving the known-hosts entry. Do not blindly
   trust `ssh-keyscan` output. Application/database/provider credentials stay in
   the existing ignored server environment file, outside GitHub Actions.
5. If desired, configure a `main` ruleset requiring **Verify and package**. Keep
   direct pushes possible for the owner's requested workflow; do not require PRs
   incidentally. With a required status check, a new direct push may be rejected
   until that exact commit has passed CI on a temporary branch. Push it there,
   wait for CI, then fast-forward `main` to the verified commit. Never bypass
   failed checks or force push to release.
6. After owner acceptance, run final verification, commit only intended files,
   reconcile the existing deployment branch with remote `main`, and push the
   accepted commit to `main`. Follow the first run in **Actions → CI and delivery**
   and confirm the **production** deployment and HTTPS app manually. Later accepted
   pushes repeat this automatically. Manual dispatch on `main` retries its release;
   dispatch on other branches verifies only.

### Deployment behavior and failures

`deployment/deploy.sh` executes inside `/srv/tripdock-releases/<commit>`. It loads
the prebuilt images, copies the existing server `.env` to a mode-600 release file,
and sets `TRIPDOCK_RELEASE` to the exact commit through the process environment.
It never edits the operator's canonical `.env`, copies local data, or removes
volumes. Compose retains the existing `tripdock-production` project and database.

GitHub serializes deployments without cancelling a running deployment. A server
lock also serializes manual calls. Before transfer, the workflow skips a commit
if a newer `main` head has superseded it. A push arriving after this check may
deploy next, after the in-progress release finishes.

Before applying migrations, the script takes a custom-format database backup
through the existing backup script. A fresh one-shot migration runs for every
release; failure prevents replacement of the application containers. The script
then recreates only API/web, waits for container health, and checks HTTPS and the
public GraphQL read path without generating AI requests or synthetic trip data.
There may be a brief interruption while the single-instance containers restart.

Successful releases update `/srv/tripdock-releases/current` and retain the former
successful directory in `previous`. The first release records `/srv/tripdock` as
its predecessor. Source, protected environment snapshots, and image tags remain
for recovery; transferred archives are removed after success. Artifacts on GitHub
expire after seven days. Monitor Droplet disk use and explicitly remove obsolete
releases/images only after preserving the needed recovery versions. Do not use
volume pruning or delete database backups as incidental housekeeping.

Failed health/HTTPS checks mark the Actions deployment as failed and leave the
success pointers unchanged. Inspect Compose logs in the failed release directory.
There is no automatic database restore or application rollback: schema migration
compatibility must be considered before choosing a previous application version.
After a failed deployment, `current` identifies the last successful automated
release; before the first successful automated deployment, use `/srv/tripdock`.
After a successful deployment, `previous` identifies its predecessor.

To roll back application containers to a compatible automated release:

```sh
cd /srv/tripdock-releases/SELECTED_FULL_COMMIT_SHA
export TRIPDOCK_RELEASE=SELECTED_FULL_COMMIT_SHA
docker compose --env-file deployment/release.env -f compose.production.yaml \
  up -d --no-build --no-deps --wait --wait-timeout 180 api web
```

For the original `/srv/tripdock` installation, use its `deployment/.env` and the
original image release identifier instead. Never rerun old migrations or restore
the database merely to roll back application images. Serialize manual recovery
with the same `/srv/tripdock-releases/deploy.lock` lock and pause Actions delivery
while investigating. Fix forward on `main` to make GitHub and production agree.
