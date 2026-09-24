# Staging on one Ubuntu VPS

This deployment runs API, worker, web, PostgreSQL 16 with PostGIS and pgvector,
Redis, SeaweedFS S3, and ClamAV on one Docker host. NGINX terminates TLS. Only ports
22, 80, and 443 need public access; Docker binds API, web, and S3 to host
loopback. PostgreSQL, Redis, worker, and ClamAV have no published ports.

Use **4 vCPU, 8 GiB RAM, 80 GiB disk** as the starting VPS size. This is a
staging estimate, not a measured capacity guarantee. ClamAV alone has a 3.5 GiB
container limit. Watch `docker stats`, disk use, and request latency before
adding data or load. Use an external S3-compatible backup bucket. A backup on
the same VPS cannot recover a lost VPS.

## Prerequisites

1. Create an x86_64 Ubuntu 24.04 VPS with SSH key access. Published images
   currently target `linux/amd64`. Point A records for
   `app.barghsa.com` and `s3.barghsa.com` to its public IP. Open inbound TCP
   22 for administration and 80/443 for HTTP/TLS. Limit SSH source IPs if
   possible. Do not open Docker service ports.
2. Install Ansible locally. Set `ansible_host`, `ansible_user`, domains, and a
   real certificate email in copies of
   [`inventory.example.ini`](ansible/inventory.example.ini) and
   [`vars.example.yml`](ansible/vars.example.yml). Keep private inventory and
   variables outside the repository.
3. Prepare a separate S3-compatible bucket for backups. Enable encryption,
   versioning, retention, and access restricted to this VPS. Create credentials
   that can upload and read objects. Test provider compatibility with `mc mirror`
   before relying on the object backup.
4. Merge this deployment code to `main`. In GitHub Actions, run **Publish
   staging images** against `main`. Download its `staging-images-<sha>` artifact;
   it contains six immutable image digests. The workflow publishes application
   images to GHCR and includes reviewed Redis and SeaweedFS pins.
   For private GHCR packages, log in on the VPS with a token that has
   `read:packages` for the packages. Never put the token in `runtime.env`.

## Provision host

From this checkout:

```sh
ansible-playbook -i /private/path/staging.ini \
  -e @/private/path/staging-vars.yml \
  deploy/staging/ansible/playbook.yml
```

Provisioning installs Docker Engine, Compose, NGINX, Certbot, AWS CLI, release
scripts, and the backup timer. It obtains one certificate for both names. DNS
and port 80 must work before the first run. Re-running the playbook updates
deployed scripts and NGINX configuration without replacing active secrets.

## Configure and release

On VPS, as root:

1. Copy `/etc/barghsa/staging/runtime.env.example` to `runtime.env` and
   `/etc/barghsa/staging/backup.env.example` to `backup.env`. Set `0600`
   permissions and fill every required value. Keep URLs and credentials aligned:
   `DATABASE_URL` and `PGDIRECT_URL` must point at `postgres:5432`, Redis at
   `redis:6379`, private S3 endpoint at `http://objectstore:8333`, and public
   endpoint at `https://s3.barghsa.com`. URL-encode special characters in the
   database password inside URLs. `APP_PUBLIC_URL` and `API_PUBLIC_URL` must
   both equal `https://app.barghsa.com`.
2. Create a strong passphrase in `/etc/barghsa/staging/backup.key` (mode
   `0600`). Keep a copy outside the VPS; losing this passphrase makes database
   backups unreadable. Set `BARGHSA_BACKUP_GPG_KEY_FILE` to this path.
3. Upload the workflow's `images.env` artifact to a new file such as
   `/etc/barghsa/staging/candidate-<sha>.env`, owned by root, mode `0600`.
4. If GHCR packages are private, run `docker login ghcr.io` as root with a
   read-only package token using `--password-stdin`. Store the token in a
   password manager. Docker's root credential store must remain private.
5. Run:

```sh
sudo /usr/local/sbin/barghsa-staging-release \
  /etc/barghsa/staging/candidate-<sha>.env
```

Release pulls images, starts stateful services (SeaweedFS creates the S3 bucket), takes
an encrypted PostgreSQL backup and an offsite object mirror, stops worker,
runs migrations once, then replaces API, web, and worker. It waits for container
health and checks HTTPS endpoints. Successful manifest becomes
`/etc/barghsa/staging/active-images.env`. If app rollout fails, it restores
previous app images. **A database migration is not rolled back.** Write
database changes in expand/migrate/contract order so the previous app can
still run after a failed release.

`BARGHSA_DISPOSABLE=true` skips the pre-migration backup and is only suitable
for test data that may be lost. Normal staging keeps it `false` and requires
the external backup destination.

## Verify and operate

```sh
curl -fsS https://app.barghsa.com/api/health/ready
curl -fsS https://app.barghsa.com/ >/dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' https://s3.barghsa.com/)" = 403
sudo docker compose --env-file /etc/barghsa/staging/runtime.env \
  --env-file /etc/barghsa/staging/active-images.env \
  -f /opt/barghsa/staging/compose.yml ps
sudo docker compose --env-file /etc/barghsa/staging/runtime.env \
  --env-file /etc/barghsa/staging/active-images.env \
  -f /opt/barghsa/staging/compose.yml logs --tail 100 api worker
```

Enable daily backups after the first successful release and a manual backup
test:

```sh
sudo /usr/local/sbin/barghsa-staging-backup
sudo systemctl enable --now barghsa-staging-backup.timer
sudo systemctl list-timers barghsa-staging-backup.timer
```

The timer waits for any active release. Backups include an encrypted custom
PostgreSQL dump plus an object mirror in `<backup bucket>/objects/`. Mirror
does not delete objects from the destination; destination versioning preserves
older overwritten versions. Database dump and object mirror are sequential,
so they are not an atomic snapshot. Keep application writes quiet during a
restore drill if exact cross-store consistency matters.

To restore, use a **separate** host or disposable Compose project. Download a
chosen `postgres/*.dump.gpg` and matching `.sha256` from the external bucket,
verify with `sha256sum -c`, decrypt with `gpg --decrypt`, and feed the result to
`pg_restore --clean --if-exists` against an empty staging database. Copy needed
objects from the external bucket's `objects/` prefix to the new S3 bucket.
Run the target app's migration command, then check readiness and representative
uploads/downloads. Never test a destructive restore against the live staging
database. Perform this drill before treating backups as reliable.

For app rollback without another migration, release the previous manifest as
a fresh candidate file. Keep previous digests and verify their GHCR access.
For a broken database migration, restore to a new host from the last verified
backup and switch DNS only after checks pass.

Routine releases keep PostgreSQL, Redis, SeaweedFS, and ClamAV image digests fixed. If any
digest changes, the release script stops before changing containers. For an
infrastructure upgrade, schedule a maintenance window and first prove recovery
on a separate host. A PostgreSQL major-version change requires a database
upgrade or dump/restore into a fresh volume; never start a new major version
against the existing data directory. Update the active manifest only after the
new stateful service is healthy, then run the normal app release.

## Later PaaS split

The API and worker already use one image with different commands. Web has its
own image. This keeps a later Liara migration limited to service wiring:
PostgreSQL with required extensions, Redis, object storage, ClamAV scanning,
API, worker, and web each need an equivalent managed service or app. Carry
`runtime.env` settings into provider secrets; do not copy the VPS Compose file
into Liara. Verify PostgreSQL extension and migration support, private service
networking, worker lifecycle, upload size, and presigned S3 URLs before
cutover. Keep the VPS backup and restore procedure until PaaS data recovery has
been exercised.
