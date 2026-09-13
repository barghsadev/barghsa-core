# PostgreSQL physical backup and recovery

The backup image includes PostgreSQL16, PostGIS, pgvector, GPG and the pinned S3
SDK. Build from the repository root using
`docker build -f packages/db/scripts/backup/Dockerfile -t barghsa-postgres:local .`.
Use the same PostgreSQL major version and required extension binaries for recovery.
The image is also the default Compose PostgreSQL image. Compose explicitly loads
`postgres-config/barghsa-postgres.conf`; mounting a configuration file alone does
not activate it. Production memory sizing still requires workload measurements.

## Credentials and storage

Inject these into the backup process and PostgreSQL archiver, without putting
values in source control or command arguments:

- `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION` and
  `BACKUP_S3_ACCESS_KEY` / `BACKUP_S3_SECRET_KEY`. Optional temporary credentials use
  `BACKUP_S3_SESSION_TOKEN`. HTTPS certificate validation is on. `BACKUP_ALLOW_HTTP=true`
  is an explicit local MinIO exception; use HTTPS for off-server backups.
- `BACKUP_CLUSTER_ID`: a stable namespace unique to this environment. Physical
  cluster system identifiers further separate WAL after reinitialization.
- `BACKUP_GPG_PASSPHRASE_FILE`: a readable one-line symmetric passphrase, materialized
  from the secret manager outside the checkout. Restrict file access to the service
  user. Keep a recoverable secret-manager copy. Do not rotate away the key while
  retained backups or WAL still require it. Key rotation needs a separate namespace
  and a complete new recovery chain before retiring the old one.
- `PGDIRECT_URL`: direct PostgreSQL URL for full backups, with replication authority
  and certificate validation in production. Pooler URLs are unsuitable. URL
  credentials become private child-process environment values, never command-line
  arguments or log output. Unsupported connection options fail explicitly.
- `PGDATA`: source data directory for `archive-wal.sh`, allowing local cluster
  identity lookup without an extra SQL connection.

Provision a private bucket separately. Bucket credentials need signed list/get/put
and retention delete access within this namespace. Configure incomplete multipart
upload expiration and versioned-object retention on the storage provider; deleting
a current object does not purge prior versions. Preserve legally held objects.
Use separate writer and recovery credentials where supported. S3 conditional puts
must work; a storage provider that ignores preconditions is unsuitable.

For local Compose, the base configuration leaves archiving off until the key exists.
Set the two required overlay variables, then use
`docker compose -f docker-compose.yml -f docker-compose.backup.yml up -d --build`.
The secret file must be readable by the container's postgres user. This command
restarts infrastructure and is an operator action, not part of audit execution.
Check `SHOW config_file`, `SHOW archive_mode`, `SHOW archive_command` and
`SHOW shared_preload_libraries` on the running instance. Force a WAL switch and
confirm `pg_stat_archiver` and the matching encrypted storage object. Missing
credentials cause archival failures and WAL growth; monitor both before enabling.

## Daily full backups and retention

Run `/opt/backup/backup-pg.sh` daily as the backup service user. `--label <unique-id>`
is optional. `--dry-run` makes no changes and prints no credentials. `BACKUP_DIR`,
if set, is an existing temporary-parent directory; only the command's private child
is removed. Provide space for native tar files, extracted verification files and
encrypted output. Backup errors are fatal; they never create a completion marker.

The command uses native tar output to isolate all tablespaces, including ones
created during backup. It extracts them into private paths, runs `pg_verifybackup`,
encrypts with GPG AES256 and uploads a unique payload. It publishes
`postgres/<cluster>/full/<label>/manifest.json` last. A duplicate label is rejected.
The manifest includes the ciphertext digest, size, cluster ID, times and WAL ranges;
the encrypted metadata must match it during restore. Legacy plaintext `full/` and
`wal/` objects are not accepted or deleted by these commands.

PostgreSQL continuously invokes `/opt/backup/archive-wal.sh %f %p`. Objects live at
`postgres/<cluster>/wal/<system-id>/<filename>.gpg`. Retries accept an existing
object only when decryption yields the same bytes. Conflicting content fails.
Never use a no-op archive command to clear an archival backlog.

After a successful daily backup, run `python3 /opt/backup/physical_backup.py prune`.
The minimums are `BACKUP_RETENTION_DAYS=14` and `WAL_RETENTION_DAYS=7`. Cleanup keeps
every recent full backup and each system identifier's latest full backup, even when
old. It retains WAL back to the earliest retained backup's start, with a two-day
margin, as well as all WAL from the last seven days and timeline history files.
No completed backup means no cleanup. Listings are paginated. Failed uploads can
leave unreferenced encrypted blobs; inspect these separately before deletion.
Do not prune an explicitly selected expired backup during an active recovery.

## Isolated full or point-in-time restore

1. Record incident time, last independently confirmed committed transaction and the
   desired recovery point. Stop application writes before a cutover. Keep the source
   database and its volumes intact. Obtain approved credentials, backup key and the
   matching image. Start the recovery timer before provisioning/downloading.
2. Use an empty parent on separate storage. The target itself **must not exist**:

   ```sh
   /opt/backup/restore-pg.sh --latest --target-dir /recovery/candidate
   # Or a timezone-qualified point, choosing the newest eligible full backup:
   /opt/backup/restore-pg.sh --pitr '2026-09-13T10:00:00Z' --target-dir /recovery/candidate
   ```

   `--backup <label>` selects a specific completed backup. A target before that
   backup completed is rejected. The command verifies ciphertext, decrypts,
   validates paths and metadata, runs `pg_verifybackup`, and prepares
   `/recovery/candidate/data`. It retains relative tablespace links and removes the
   source tablespace map so recovery cannot redirect them into source storage.
   Output says `prepared=true,replayed=false`: preparation is not completed recovery.

3. Run the clone as postgres with a private socket directory. The generated config
   disables network listening and archiving, removes inherited replication settings
   and fetches encrypted WAL on demand. Keep the backup tools, storage credentials
   and key available throughout replay. Example with a postgres database role:

   ```sh
   mkdir -m 700 /recovery/candidate/socket
   pg_ctl -D /recovery/candidate/data -l /recovery/candidate/postgres.log \
     -o "-c unix_socket_directories=/recovery/candidate/socket" -w start
   psql -h /recovery/candidate/socket -U postgres -d barghsa \
     -c 'SELECT pg_is_in_recovery(), pg_last_xact_replay_timestamp();'
   ```

   Configure an explicit local peer mapping if the database role differs from the
   OS user. Do not expose a trust-authenticated socket outside a private directory.
   `pg_ctl start` may return while WAL replay continues; wait for successful queries
   and `pg_is_in_recovery() = false`. A PITR target promotes only after reaching the
   configured point. A genuinely missing archive returns1; storage/authentication/
   decryption failures return126 and abort recovery instead of silently ending it.

4. Compare users, orders and invoices against an independently captured baseline.
   Run application-specific loss/integrity assertions and core service smoke checks.
   Counts alone cannot prove no data loss. A recent full backup is not proof of a
   five-minute RPO: compare the replayed state to known committed source evidence.
   Missing tail WAL can only be assessed with that independent evidence. Record
   unavailable RPO evidence as unknown, never zero. Record elapsed RTO through
   service readiness; thresholds are RPO≤300s and RTO≤3600s.
5. Only after those checks, configure certificate-validated TLS and firewall rules
   for the restored database, approved local/network authentication, and a **new**
   archive namespace before accepting writes on the promoted timeline. Repoint the
   app's direct and pooled connection targets together, start core services and
   verify transactions. Keep the source read-only to avoid two active writers.

Configuration, key and file rehydration is a separate prerequisite covered by
[the config restore runbook](config-restore-runbook.md). Do not point restored
applications at providers with live credentials until the operational review allows it.
Physical backup success does not prove those non-database assets are recoverable.

## Evidence and remaining operations

The isolated test suite exercises signed MinIO uploads, encryption, checksum
rejection, native verification, PostgreSQL WAL/PITR replay and external tablespaces.
It also checks immutable names, credential errors and safe local cleanup. It does
not prove production RPO/RTO, off-server storage, live TLS/firewall, quarterly
scheduler execution or alert delivery. Those require retained operational results.
The older `verify-restore.sh` exercise is being repaired separately; do not use its
backup-age calculation as an RPO measurement or its two-hour threshold as acceptance.

Implementation references: [PostgreSQL continuous archiving](https://www.postgresql.org/docs/16/continuous-archiving.html),
[S3 conditional uploads](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/put_object.html)
and [paginated listings](https://docs.aws.amazon.com/boto3/latest/guide/paginators.html).
