# Staging on the Liara VPS

`stg.barghsa.com` is the only required DNS name. NGINX serves the web app at
`/`, forwards `/api/` to the API, and forwards `/barghsa-staging/` to the
private S3 gateway without changing the signed URL path. PostgreSQL (with
PostGIS and pgvector), Redis, SeaweedFS, ClamAV, API, web, and worker all run
as Docker Compose services on the same Ubuntu 24.04 VPS. Only NGINX ports 80
and 443 and the VPS SSH port 30222 are public. AI inference runs in a separate
private service on port 9091 with its own database pool and memory limit.

## First host setup

Point the `stg.barghsa.com` A record to `89.42.199.13`. Allow inbound TCP 80,
443, and 30222 at the provider firewall. Install host packages:

```sh
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-buildx docker-compose-v2 nginx certbot
mkdir -p /var/www/barghsa-acme /etc/nginx/snippets /opt/barghsa/staging /etc/barghsa/staging
```

The staging PostgreSQL image uses BuildKit to share a signed Ubuntu package
index across build stages. Check `docker buildx version` on existing hosts
before rebuilding that image.

Install `nginx-bootstrap.conf` as `/etc/nginx/conf.d/barghsa-staging.conf`,
remove `/etc/nginx/sites-enabled/default`, test and reload NGINX. Obtain the
one-domain certificate with HTTP-01 webroot validation:

```sh
certbot certonly --webroot -w /var/www/barghsa-acme \
  -d stg.barghsa.com --email majidnajafi.dev@gmail.com \
  --agree-tos --non-interactive
```

The automatic Certbot timer and `certbot-reload-nginx.sh` renewal hook keep
the certificate current. DNS challenge is not required while port 80 reaches
the host.

## Integrated QA preview

Use the commit in `/release.json` to identify the preview. The login footer
shows the root package version, which follows the formal release schedule.
Preview evidence is recorded on the launch-candidate tasks in the board.
Formal milestone acceptance and its Telegram notification use the release
procedure below.

The staging API and web services set `BARGHSA_DEPLOYMENT_ENV=staging` at
runtime. Both return `X-Environment: staging`, and the web server renders a
localized staging badge. Production manifests set the production label for
the same build artifacts.

The preview runs on a copy of the staging database. The previous app checks
its packaged migration head at readiness, so recovery restores its original
database connection and image manifest together. The protected pre-preview
snapshot and configuration are retained on the staging host. The preview
database is retained separately if recovery is needed.

Use staging accounts and synthetic data. The payment sandbox reports
`realFunds: false` and requires a separate operator for settlement. [Sandbox procedure](../../docs/operations/staging-payment-sandbox.md).

| Service      | Customer workflow                                                                                                         | Staff workflow                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Electricity  | `/electricity` and `/electricity/advanced`. Quote and submit from a legal profile, then check the invoice and contract.   | `/admin/electricity-orders`. Review the submitted order and verify the resulting customer state.     |
| Saving       | `/savings`. Select the QA plan and compatible hardware from an individual profile, accept the test agreement, and submit. | `/admin/saving-orders`. Review and track fulfillment after a controlled test payment.                |
| Solar        | `/solar/requests/new`. Submit a request with a synthetic installation address and test documents.                         | `/admin/solar-requests`. Verify document review and the contract and invoice handoff.                |
| Consultation | `/consultations`. Choose an eligible service and submit a request.                                                        | `/admin/consultations`. Assign and review the request, then check the fee offer and completion flow. |

## Release

Before transferring a new image, check free space on the filesystem backing
Docker. Registry download sizes describe compressed layers. Leave room for
their unpacked contents and the retained rollback images. If unused build
cache is consuming that space, inventory its last-use dates and reclaim only
unused cache with an age filter and retained-space budget. Compare image,
volume and running-container identities before and after maintenance, then
read back staging health and release metadata.

Prepare the version and notes after the release milestone and its gates are
accepted. Use a Docker-equipped machine with SSH key access to the VPS and a
`codex/preflight/<batch>` branch whose tip matches the current
remote `main`, seeding a new one there if needed. Push the exact candidate to
that branch so CI has a real base for affected tests. Once GitHub Actions reports
**Verify monorepo integrity** as successful
on the candidate SHA, push that same SHA directly to `main`. Verify the remote
SHA and immediately enqueue the immutable release:

```sh
python3 deploy/staging/release-queue.py enqueue --commit "$(git rev-parse HEAD)" \
  --retained-scans /absolute/path/verified-retained-scans \
  --screenshot /absolute/path/reviewed-persian.png
```

Omit `--retained-scans` for the first staging install, which scans all four
new images. Screenshots are optional. This command returns immediately and starts a detached
worker. Queue admission and the deployment entry point read the accepted
milestone and gate evidence from the exact pushed commit. The subsequent
`main` CI run and staging deployment are independent;
neither blocks work on the next authorized batch.
The worker runs `./deploy/staging/deploy.sh` from an isolated checkout of the exact
pushed commit, then attaches the captured screenshots. The main Persian announcement
and exact live release are required. An optional screenshot failure records a
`screenshot_warning` and rechecks the main announcement without retrying images;
it cannot block later deployments after those required confirmations pass. Unknown
image outcomes remain unconfirmed in the notification receipts. It serializes releases
through the required Telegram confirmation, so a newer rollout cannot replace an older release mid-post.
The caller's branch, working files and subsequent commits do not affect the release.
The job directory stays private. Git creates tracked files with their usual
read and execute permissions so the non-root container user can load them.

Queue jobs, frozen screenshots, worker code and logs live outside the checkout in
`~/.local/state/barghsa-staging-queue`. Run `python3 deploy/staging/release-queue.py status`
to inspect them. A failed or interrupted job stops the deployment queue while building
can continue. Inspect that job's `deploy.log`, resolve the failure and explicitly run
`python3 deploy/staging/release-queue.py retry --commit <full-sha>`. If the
verified runtime image receipt is already on disk, the worker confirms the
exact live web and API revision and dependency health before resuming the
Telegram step. Unknown results for the main Telegram message still require channel inspection and
the notifier's explicit recovery
before retrying; the queue never bypasses that guard. An optional image warning never
claims that every screenshot was delivered; inspect the channel before recovering an
unknown image, and verify that its original release is still live. A restarted machine resumes queued work
with `python3 deploy/staging/release-queue.py work`. It does not auto-replay interrupted
deployments. The worker uses lower CPU priority to favor ongoing builds.

Prepare the root `package.json` version and `releases/<version>.md` only when
the planned release milestone and its gates are accepted. Batches within a milestone
push to main without version bumps, deployments or announcements. See
[the release plan](../../kanban/RELEASES.md) and [working process](../../kanban/WORKFLOW.md). Use Semantic Versioning:
PATCH for necessary compatible hotfixes, MINOR for planned capability milestones,
and MAJOR for breaking changes. The initial numbered release is `0.1.0`.
Never reuse a published version for a different release. The release notes are in Persian, start with `برقسا نسخه <version>` and list
concrete changes as Markdown bullets. Screenshot captions are also Persian.

The login page reads the root version at build time. Both web builds emit
`release.json` with that version and the exact commit. Deployment passes the
commit into the Docker build, verifies the live metadata after the existing
health checks, then sends the release notes and commit to Telegram. Failed
deployments or mismatched live metadata cannot send a success announcement.

Configure an authorized Telegram bot and channel in the local secret file
`~/.config/barghsa/staging-telegram.json`, with permissions `600`:

```json
{
  "bot_token": "<configured privately>",
  "chat_id": "-1004467450624"
}
```

The bot needs permission to post to the channel. A numeric channel ID is also
accepted. `BARGHSA_TELEGRAM_CONFIG` selects a different secret file; alternatively,
set both `BARGHSA_TELEGRAM_BOT_TOKEN` and `BARGHSA_TELEGRAM_CHAT_ID` in the deployment
environment. Credentials are never included in release metadata or messages.
Deployment verifies the destination is a channel before building images.

Customer-linked Telegram uses the owner-approved `@barghsa_dev_bot` identity,
with private positive chat IDs only. Release Radar remains a separate channel
destination. Provision `CUSTOMER_TELEGRAM_BOT_TOKEN` and a random 32–256 character
`CUSTOMER_TELEGRAM_WEBHOOK_SECRET` (letters, digits, `_`, `-`) privately in the
root-only `/etc/barghsa/staging/runtime.env`. The existing release config supplies
the bot token; it does not supply the customer webhook secret. The product stays
unavailable without both credentials and successful bot identity verification.

The authenticated callback is `POST /api/telegram/webhook`, with Telegram's
`X-Telegram-Bot-Api-Secret-Token` header. Before configuring that callback, identify
the owner of the currently active webhook and arrange its handoff. Do not overwrite
or delete an unrelated webhook, poll `getUpdates`, or restart retired automation.
No deployment script changes the webhook automatically. After an accepted release,
verify the actual callback, a fresh customer/session/profile link, private reply,
root-version footer and the persisted exact Telegram message receipt. Unknown
outbound delivery is terminal and must never be automatically resent. Production
activation remains subject to explicit production authorization.

The owner designated `eu.barghsa.com` as the external Telegram transport host
because staging cannot reach Telegram. Its restricted HTTPS relay uses protected
`CUSTOMER_TELEGRAM_TRANSPORT=external-eu`; an unset value retains direct Telegram
access. Follow the [external transport procedure](../telegram/README.md) for TLS,
source restrictions, callback preflight and the authorized one-webhook handoff.
The application's private linkage, current-authority checks, audience isolation
and durable no-replay receipts remain required.

Confirmed message receipts live outside the checkout under
`~/.local/state/barghsa-staging-releases`, overridable by
`BARGHSA_RELEASE_STATE_DIR`. The worker also retains the verified summary and
any confirmed grouped album in `telegram.json` and includes their message IDs
in the completed release job. The configured name or numeric ID must resolve
to Barghsa Release Radar (`-1004467450624`). Repeating a confirmed notification
reuses its receipt. If notification fails after a healthy deployment, rerun only:

```sh
python3 deploy/staging/notify-release.py --commit "$(git rev-parse HEAD)"
```

A timeout can leave publication uncertain. Inspect the channel before using
`--retry-unknown`; the script never automatically retries an uncertain send.

The first release builds four `linux/amd64` images. Later releases build only
API/worker and web images, retaining the active PostgreSQL and ClamAV images
and all Docker volumes. The script transfers images over SSH, uploads
Compose and NGINX configuration, initializes root-only random staging secrets
on first deployment, runs the release script, and checks HTTPS plus a private
S3 write and public signed read. The probe deletes its exact uploaded version
and uses conditional deletion for unversioned objects. An uncertain write
blocks the rollout even when the probe recovers and deletes its own object.
If storage cannot confirm ownership or cleanup, inspect the dedicated
`deployment-check/` prefix before retrying.
Before transferring newly built images, the
worker uses the high and critical vulnerability gate, generates a CycloneDX
SBOM for each exact image, and runs the strict license policy against those
SBOMs and the built browser assets. It keeps each attempt in a separate private
scan directory. A failed scan or license check stops the release before transfer.
App and web transfer tags include the full
source revision and image ID, so a rebuild cannot replace a rollback tag. The
release checks the loaded app and web image IDs against the candidate manifest before
startup. For an initialized installation, the worker resolves the retained
PostgreSQL and ClamAV tags to exact image IDs before building or transferring
images and pins those IDs in the candidate manifest. The release checks the
OCI revision labels on the app and web images, verifies the running
PostgreSQL and ClamAV IDs before migration, and reads back all four IDs
before saving the active manifest. The VPS matches the public web metadata's
commit and version to the candidate while rollback is still available. The
worker compares the four running IDs with the candidate manifest and saves the
commit and verified Docker image IDs in its protected `runtime-images.json`
before sending the Telegram note. A completed job includes the same receipt
under `runtime_images` in `job.json`. Its `image_scans` field indexes the scan receipts and their
checksums for transferred images. The worker checks the deployed IDs, report
and SBOM checksums, and license dispositions before announcing. The
`license_sha256` field binds the passing report to the deployment receipt.
Release acceptance requires readiness from the exact API commit, healthy
PostgreSQL, Redis and object storage, and an empty readiness warning list.
Initialized staging requires `--retained-scans` at enqueue. Use a private
directory with the passing runtime scanner's numbered PostgreSQL and ClamAV
receipts, vulnerability reports and CycloneDX SBOMs, in that order. The queue
pins the scan index when the job is created. The worker matches it to the
retained Docker image IDs before building or transferring images, and checks
the same evidence against the running image IDs before announcing. The
result is stored as `runtime_images.retained_image_scans`. Make both exact
images available in the release worker's local Docker before queueing. The
worker checks their SBOM package and license entries, verifies the installed
PostgreSQL notices by image ID, and applies the release commit's license policy
before any image transfer. The protected runtime receipt records the separate
`retained_license_report` path and its `retained_license_sha256`. If a failed job
omitted the directory, supply it with `retry --retained-scans`. A recorded
selection stays fixed for that job. Keep signed license
dispositions for the retained images with the candidate's release evidence.
Record registry manifest digests separately when publishing to a registry.
Subsequent releases preserve
`/etc/barghsa/staging/runtime.env` and Docker volumes.
The active image manifest also records `BARGHSA_POSTGRES_VOLUME`. Older
manifests use `barghsa-staging_pgdata`. Normal releases carry the recorded name
forward, require the active volume to exist, and verify the actual PostgreSQL
mount before migration and again before accepting the deployment.
For SBOMs generated from a saved image, verify the running Docker image ID
against the archive descriptor, then verify the selected platform manifest,
config and layer digests. The scanner can report the config digest when the
Docker image ID is the manifest or index digest. Keep the verified chain with
the scan receipt. Upgrade a retained stateful image through its backup and
restore procedure before release when its exact scan fails the gate.

### Reuse an accepted candidate's scanned images

For an initialized staging installation, retain the exact app and web images
when running the candidate's manual CI gates. This path uses the existing
database and scanner images. The opt-in artifact is built only after the
strict image and license checks pass.

```sh
gh workflow run ci.yml --ref "$CANDIDATE_REF" -f package_staging_images=true
gh run view "$CI_RUN" --json headSha,event,status,conclusion,jobs
gh run download "$CI_RUN" -n staging-image-bundle --dir "$PROTECTED_BUNDLE_DIR"
```

Before publishing, confirm the run is the successful manual CI run for the
exact candidate SHA. Download into a new private directory outside the
checkout and retain it until the deployment and its receipts are verified.
After the accepted commit is pushed and read back, include the directory in
the usual queue command.

```sh
python3 deploy/staging/release-queue.py enqueue --commit "$CANDIDATE_SHA" \
  --image-bundle "$PROTECTED_BUNDLE_DIR" --retained-scans "$PROTECTED_RETAINED_SCAN_DIR"
```

The worker verifies the selected manifest, archive and image evidence without
using local Docker or contacting CI. The server verifies the transferred
archive before loading it. The existing health, migration, image readback and
Telegram checks apply. Keep the retained database and scanner scan receipts
with the same release evidence.

Redis and object-store images are pinned by digest. Already installed exact
images are reused with Compose's `--policy missing`; missing images are still
pulled and a failed pull blocks the release.

The NGINX configuration gives auth, upload and AI separate per-IP quotas.
The edge returns a localized JSON `429` and `Retry-After` while the API keeps
its own account and destination limits. NGINX replaces forwarded addresses
with the actual client address. The API trusts only the configured immediate
Docker bridge gateway. The same API proxy settings preserve upload bodies,
streaming responses and WebSocket upgrades on the limited paths.

On the server, view status and logs with:

```sh
docker compose --env-file /etc/barghsa/staging/runtime.env \
  --env-file /etc/barghsa/staging/active-images.env \
  -f /opt/barghsa/staging/compose.yml ps
docker compose --env-file /etc/barghsa/staging/runtime.env \
  --env-file /etc/barghsa/staging/active-images.env \
  -f /opt/barghsa/staging/compose.yml logs --tail=100 api worker
```

The API and worker share an image. The worker uses its own command and health
check. The release stops the API, worker and AI inference before applying
migrations. A failed stop cancels the migration and enters rollback. The release
starts the candidate API after migrations finish and waits for its health check.
After a failure, the previous app image checks the current database schema
before the release restores the previous API, worker, AI inference and web
images. The release stops those services if the schema check fails. Recover
the matching app and database pair before accepting writes, or roll forward.
Check Compose status and the active manifest before retrying. Use the
[PostgreSQL restore runbook](../../docs/operations/backup/postgresql-restore-runbook.md)
for database recovery.

The generated Zarinpal merchant ID is deliberately invalid. Configure a real
staging merchant before testing payments. SMS, email, and other external
providers also require their own settings in the app's admin UI.

## Data and backups

Before stopping application writers or running migrations, the release reads
the exact retained ClamAV daemon's loaded signature version and UTC build time.
An unavailable, invalid or at least 48-hour-old database blocks rollout. The
worker stores the engine version, signature version and build timestamp in
`runtime_images.scanner`. See the [scanner runbook](../../docs/operations/clamav-signatures.md)
for mirror checks and the sealed upload rehearsal.

The initial runtime sets `BARGHSA_DISPOSABLE=true`. Docker volumes survive
container and image releases. An installation with data to retain needs an
approved off-server backup destination and tested recovery before changing
that flag. Place the backup tool's `BACKUP_S3_*`, `BACKUP_CLUSTER_ID` and
replication-authorized direct `PGDIRECT_URL` in root-owned
`/etc/barghsa/staging/backup.env`. Allow the dedicated backup role's
replication connection from the staging Docker network. Mount the recoverable,
single-line backup key from `/etc/barghsa/staging/backup-key` with read access
for the `postgres` user inside the exact image. Keep both settings and key
outside the checkout.

For non-disposable installations, the worker stops the preceding writers and
uses the retained PostgreSQL image's encrypted backup tool against the direct
database URL. It requires HTTPS, verifies the backup using PostgreSQL's native
manifest, reads back the encrypted object, and records
`BARGHSA_STAGING_MIGRATION_BACKUP_V1` for the running database system before
invoking migrations. A failed upload, readback or mismatched receipt enters
rollback. The retained PostgreSQL image must provide the readback receipt.
The release worker copies the backup label, database system ID, encrypted
object name, length and SHA-256 into `runtime_images.migration_backup` in
`job.json`. A disposable release records `status: disposable` in that field.
Use the verified checkpoint identity to recover the exact pre-migration data.
Apply the [PostgreSQL restore runbook](../../docs/operations/backup/postgresql-restore-runbook.md)
to test recovery and provision scheduled backups and WAL/PITR. Configuration
and uploaded objects require their own backup and restore receipts.

Provision continuous encrypted WAL separately from the release. Put only
the off-server `BACKUP_S3_*` storage settings and the matching
`BACKUP_CLUSTER_ID` in root-owned `/etc/barghsa/staging/wal-archive.env`.
The WAL namespace for the installed cluster and its successor must have
recoverable keys. Use the same cluster namespace and key in the full backup
configuration, with separate credentials where supported. The app and
database container do not need the full-backup replication URL.

During the approved database cutover, add `compose.wal-archive.yml` to
both the cutover and subsequent manual Compose commands. Start PostgreSQL
with the prepared image and restored volume while writes are paused. Read
back `archive_mode` and `archive_command`, confirm the encrypted object for
a forced WAL switch and run a point-in-time restore. Set
`BARGHSA_STAGING_WAL_ARCHIVE=true` in the protected runtime only after
verification. The normal release reuses the running database and refuses to
run migrations if that flag is set and the encrypted archiver is inactive.
Monitor WAL backlog and disk capacity while verifying the storage path.

Check resource use with `docker stats`, `df -h`, and `docker system df`.
ClamAV may take several minutes to download signatures on first boot. Keep
one instance of each stateful service; do not scale PostgreSQL or SeaweedFS
with this single-host Compose file.

Attach relevant screenshots when available after the deployment has been verified:

```sh
python3 deploy/staging/notify-release.py --commit "$(git rev-parse HEAD)" \
  --screenshot /absolute/path/login-desktop.png \
  --screenshot /absolute/path/login-mobile.png
```

The confirmed Persian release text is not reposted. Screenshots use one photo or
one grouped album of two to ten photos, with the release version in its Persian
caption. Thus one release has at most one summary and one grouped visual update.
[Telegram's album API](https://core.telegram.org/bots/api#sendmediagroup) accepts
2–10 items; choose representative captures and link a gallery for extras.

The image selection is immutable for a release. Saved receipts bind every input
hash, the exact version/commit, channel, message IDs and album group ID. Unknown
outcomes require channel inspection and cannot automatically resend. Legacy
per-photo receipts are preserved and cannot trigger an extra album. Capture the
actual deployed UI or reviewed matching source build, and keep originals outside
the checkout. Never post every screenshot separately.
