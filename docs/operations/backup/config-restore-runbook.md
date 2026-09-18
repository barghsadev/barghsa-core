# Configuration and critical-file recovery

T-04.01.07 extends the [PostgreSQL recovery procedure](postgresql-restore-runbook.md).
Use the packaged PostgreSQL 16 backup runtime and its Python dependencies. The scripts
require signed S3 access, GPG and psql. They do not prompt for credentials.

## Capture scope

`config_backup.py` exports all stored versions from its explicit `CONFIG_TABLES`
inventory, including active versions and the drafts/history needed to interpret
activation and effective dates. This includes application configuration, provider
configuration, notification templates, product/price/tax settings, upload policies,
reminders, AI settings, terms, contract templates, staff teams and KB relationships.
Stored encrypted provider values remain encrypted. Referenced users, uploads and KB
content require the full database and object-storage recovery procedures.

Files come from an explicit operator-owned JSON inventory. Nothing scans the checkout
for secrets. Paths are relative to `BACKUP_SOURCE_DIR`; missing files, symlinks,
nonregular files, duplicate destinations and changes during a file copy fail capture.
Include every deployed environment file, Compose file, deployment script, certificate
and application encryption key. Classification is explicit. Private keys belong under
`encryption_key`, certificates under `tls`. All four kinds are required.

Example inventory, with paths adapted to the deployed installation:

```json
{
  "version": 1,
  "files": [
    { "path": ".env", "kind": "env" },
    { "path": "docker-compose.yml", "kind": "deploy" },
    { "path": "deploy/start.sh", "kind": "deploy" },
    { "path": "tls/server.crt", "kind": "tls" },
    { "path": "tls/server.key", "kind": "encryption_key" },
    { "path": "keys/application.key", "kind": "encryption_key" }
  ]
}
```

Provision `BACKUP_GPG_PASSPHRASE_FILE` from the secret manager separately from the
application keys being backed up. Keep recovery access outside this archive. Each
application key is individually GPG-wrapped, then the complete archive is encrypted.
Recovering only the outer archive does not leave plaintext application keys on disk.

## Capture and storage

Set `PGDIRECT_URL` to the direct database connection, `BACKUP_SOURCE_DIR` to an explicit
real directory, and `CONFIG_BACKUP_FILE_MANIFEST` to the inventory. Use the signed
`BACKUP_S3_*`, `BACKUP_CLUSTER_ID` and passphrase-file settings documented in the
PostgreSQL runbook. Production storage must be off-server and use HTTPS.
`BACKUP_DIR`, if set, is an existing private work parent. Only unique child directories
created by these scripts are removed; the caller's directory is never deleted.

```bash
/opt/barghsa-backup/backup-config.sh --label incident-checkpoint
# Scheduled operation: backup first, then retention only after backup succeeds.
/opt/barghsa-backup/.venv/bin/python3 /opt/barghsa-backup/config_backup.py job
```

Objects live below `postgres/<BACKUP_CLUSTER_ID>/config/`. An encrypted unique blob is
uploaded first. The immutable `full/<label>/manifest.json` completion record is written
last. Failed collection/export/upload cannot create a completed backup. Public metadata
contains no configuration values or file names. Selection paginates storage listings.
Labels cannot be overwritten. `--dry-run` performs no reads, writes or network requests;
it is a preview of no changes, not a validation of credentials or inventory.

Retention defaults to a minimum 90-day age window and always retains the newest
completed configuration backup. It touches neither database backups nor WAL. Unreferenced
blobs from interrupted uploads remain for operator inspection; automatic pruning cannot
distinguish these from in-flight uploads. External bucket lifecycle, version retention,
object lock and replication policies must be checked separately before enabling cleanup.

## Isolated recovery

```bash
/opt/barghsa-backup/restore-config.sh --label latest \
  --target-dir /var/lib/barghsa-backup/config-recovery-incident
```

The target must not exist and its parent must exist. Recovery verifies ciphertext size
and hash, decrypts, rejects tar traversal/links, and checks the exact file inventory and
snapshot. Files preserve relative paths below `files/`, with owner-only permissions and
executable status. `active-config.json` contains the actual settings; `metadata.json`
contains encrypted-at-rest hashes and original path/mode information. Keys remain at
`files/<original-path>.gpg`. Do not print these files or diffs into shared incident logs.

To unwrap one key in a private recovery workspace, use an explicit new output path:

```bash
umask 077
gpg --batch --yes --pinentry-mode loopback \
  --passphrase-file "$BACKUP_GPG_PASSPHRASE_FILE" \
  --output /var/lib/barghsa-backup/recovered-application.key \
  --decrypt /var/lib/barghsa-backup/config-recovery-incident/files/keys/application.key.gpg
```

Validate its SHA-256 against the corresponding `metadata.json` record through a private
operator session before installation. Never overwrite deployed keys automatically.
Restore the full database and referenced objects first. The JSON snapshot is a recovery
and comparison artifact, not a safe standalone import into an empty application: it
contains references to users/uploads, and schema versions must agree. Reconcile it with
the restored database through the application's validated configuration workflows.
Install reviewed files at their original paths, preserving owner access and execute bits.
Check certificate validity, secret-provider access, health and critical application flows
before routing traffic. Record this additional service recovery time separately.

## Quarterly verification

Capture an independent baseline during an agreed configuration change freeze. Pause
writers that can change the covered configuration tables and files. Then capture the
backup being exercised. The baseline contains hashes, not secret values; keep it private
and retain it with the backup label. A stale or different baseline cannot prove current
configuration recovery. Resume writers after both captures finish.

```bash
/opt/barghsa-backup/.venv/bin/python3 /opt/barghsa-backup/config_backup.py baseline \
  --output /var/lib/barghsa-backup/config-baseline.json
/opt/barghsa-backup/backup-config.sh --label quarterly-checkpoint
/opt/barghsa-backup/verify-restore-config.sh --label quarterly-checkpoint \
  --baseline /var/lib/barghsa-backup/config-baseline.json
```

For the exercise, point `PGDIRECT_URL` at an isolated database with the matching production
schema. The verifier restores files, unwraps keys into its private workspace, compares
all hashes against the independent baseline, and rehydrates the JSON into temporary
mirrors of the real tables. It checks types, NOT NULL, CHECK and unique constraints and
exact JSON round trips, then rolls back. It writes no permanent application records.
Foreign-key relationships and application startup are checked by the full recovery
exercise, not certified by these temporary tables.

The JSON report records measured `rto_seconds` with the existing 3600-second ceiling.
`rpo_seconds=0` means exact covered-asset equality at `reference_time`, the independent
baseline timestamp. A mismatch or failure leaves RPO unknown and fails the exercise;
backup age is never substituted for data loss. `core_service_rto_seconds` remains null
until the operator measures service recovery. Exit zero means this local exercise passed.
Failure exits one and sends the report to `VERIFY_ALERT_EXECUTABLE`, when configured.
Receiver acceptance alone does not prove the on-call recipient received an alert.

Systemd templates under `packages/db/scripts/backup/systemd/` provide a daily config
backup and quarterly exercise. They are not installed or enabled by this change.
Provision a dedicated `/etc/barghsa/config-backup.env`, least-privilege credentials,
readable explicitly inventoried files, current baseline and private work directory.
Replace the baseline intentionally after each approved configuration change; the capture
command refuses an existing output. Keep the original baseline for historical backups.
Validate unit paths and permissions on the actual host before separately enabling timers.

Retain the label, source revision, schema revision, inventory, baseline timestamp,
measured RPO/RTO, report, alert-delivery evidence and operator review from each quarterly
run. Local synthetic tests do not establish off-server deployment, 90 days of retained
history, secret-manager provisioning, production schedules or application recovery.
