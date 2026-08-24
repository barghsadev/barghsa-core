# Config & Critical File Restore Runbook

**Part of:** Barghsa Restore Procedure (extends T-04.01.03)

**Responsible:** Platform Engineering Team

**Frequency:** On-demand (incident or scheduled restore)

**RTO target (non-DB assets):** < 30 minutes

**RPO target (non-DB assets):** < 7 days (config changes are infrequent; sensitive secrets should use vault/secret manager, not file backup)

---

## What this covers

This runbook covers the restoration of application configuration and critical non-DB files from encrypted off-server backups (`restore-config.sh`). The following asset types are included:

| Asset | Backup path (S3 prefix) | Priority |
|---|---|---|
| Application `.env` files | `config/<label>/` → `env-*` | Critical |
| Admin config schema snapshot | `config/<label>/` → `admin-config-snapshot.json` | High |
| Encryption keys (wrapped) | `config/<label>/` → `key-*` | Critical |
| Docker Compose / deploy scripts | `config/<label>/` → `deploy-*` | High |
| TLS certificates (public only) | `config/<label>/` → `cert-*` | High |
| Deployment/infra scripts | `config/<label>/` → `script-*` | Medium |

**Important:** Database restoration is covered by the separate PostgreSQL restore runbook (`restore-pg.sh`). Always restore the database *first*, then config files, so admin config snapshots can be re-applied to a running API.

---

## Prerequisites

1. **Access to S3/MinIO** — The `BACKUP_S3_*` environment variables must be set to the same endpoint/bucket/credentials used during backup.
2. **GPG key or passphrase** — The encryption key used during backup must be available:
   - For symmetric encryption: the `GPG_PASSPHRASE` environment variable.
   - For recipient (asymmetric) encryption: the private key must be imported into the local GPG keyring, or `--decrypt-with <key-id>` must be specified.
3. **Bash, curl, tar, gpg** — All required tools.
4. **Write access** to the target directory where files will be restored.

---

## Restore procedure

### Step 1: Verify backup availability

```bash
# Set environment (adjust for your endpoint and credentials)
export BACKUP_S3_ENDPOINT=http://minio:9000
export BACKUP_S3_BUCKET=barghsa-backups
export BACKUP_S3_ACCESS_KEY=minioadmin
export BACKUP_S3_SECRET_KEY=minioadmin

# List available config backups
python3 -c "
import json, urllib.request, base64
creds = base64.b64encode(b'minioadmin:minioadmin').decode()
req = urllib.request.Request('http://minio:9000/barghsa-backups/?prefix=config/&delimiter=/')
req.add_header('Authorization', f'Basic {creds}')
resp = urllib.request.urlopen(req).read().decode()
print(resp)
"
```

**Expected output:** A list of backup labels under the `config/` prefix, e.g. `config/2026-08-24T12:00:00Z/`.

### Step 2: Select the backup label

- **Latest backup:** Run `--label latest` (default).
- **Specific backup:** Use the ISO-8601 timestamp from the backup label, e.g. `--label 2026-08-24T12:00:00Z`.
- **Recovery point:** Choose the backup taken *before* the config change, data loss, or corruption event.

### Step 3: Restore to an isolated directory (recommended first)

```bash
./packages/db/scripts/backup/restore-config.sh \
  --label 2026-08-24T12:00:00Z \
  --target-dir /tmp/config-restore-test
```

This restores files to `/tmp/config-restore-test/` without affecting production files. Inspect the restored files before copying them in place.

**Output:** Decrypted files in `/tmp/config-restore-test/` with:
- `MANIFEST.txt` — list of backed-up files and their categories
- `backup-meta.json` — backup metadata (source, hostname, encryption method)
- Individual files with prefixed names (e.g. `env-.env`, `deploy-docker-compose.yml`)

### Step 4: Verify the restored files

```bash
# Check the manifest
cat /tmp/config-restore-test/MANIFEST.txt

# Verify file contents
ls -la /tmp/config-restore-test/

# For admin config snapshot, check JSON validity
python3 -m json.tool /tmp/config-restore-test/admin-config-snapshot.json
```

### Step 5: Apply the restored files

**For `.env` files:**
```bash
# Compare first, then copy
diff /tmp/config-restore-test/env-.env .env || true
cp /tmp/config-restore-test/env-.env .env
# Restart the application to pick up new env vars
pnpm dev       # or docker compose restart
```

**For Docker Compose / deploy scripts:**
```bash
cp /tmp/config-restore-test/deploy-docker-compose.yml docker-compose.yml
cp /tmp/config-restore-test/deploy-Dockerfile.web Dockerfile.web
cp /tmp/config-restore-test/deploy-Dockerfile.base Dockerfile.base
```

**For TLS certificates:**
```bash
mkdir -p certs
cp /tmp/config-restore-test/cert-* certs/
```

**For encryption keys:**
```bash
# Keys are already encrypted at rest in the backup (wrapped copies).
# Copy them to the key directory and verify integrity.
mkdir -p keys
cp /tmp/config-restore-test/key-* keys/
# Verify each key file
gpg --verify keys/key-*.gpg || true
```

**For deployment scripts:**
```bash
chmod +x /tmp/config-restore-test/script-*.sh
cp /tmp/config-restore-test/script-*.sh scripts/
```

### Step 6: Verify the restored application

1. Start the application (if not already running):
   ```bash
   docker compose up -d
   # or
   pnpm dev
   ```

2. Check health endpoint:
   ```bash
   curl -s http://localhost:4000/health | python3 -m json.tool
   ```

3. Verify database connectivity:
   ```bash
   curl -s http://localhost:4000/health/readiness | python3 -m json.tool
   ```

4. Test critical flows (login, config load, etc.)

---

## Automated verification

For quarterly (or ad-hoc) verification, use the automated verification script:

```bash
export BACKUP_S3_ENDPOINT=http://minio:9000
export BACKUP_S3_BUCKET=barghsa-backups
export BACKUP_S3_ACCESS_KEY=minioadmin
export BACKUP_S3_SECRET_KEY=minioadmin
export GPG_PASSPHRASE=correct-horse-battery-staple

./packages/db/scripts/backup/verify-restore-config.sh
```

The script:
1. Restores the latest config backup to an isolated directory
2. Verifies the file structure (MANIFEST, metadata, file count)
3. Checks that all files are decryptable and readable
4. Measures and records RTO
5. Produces a structured JSON result

**Exit codes:**
- `0` — All checks passed
- `1` — One or more checks failed (logged to stderr)

**Example output:**
```json
{
  "step_restore": "ok",
  "step_verify_files": "ok",
  "rto_seconds": 42,
  "rto_warning_threshold": 1800,
  "rto_critical_threshold": 3600,
  "rto_status": "ok",
  "step_measure_rto": "ok",
  "backup_label": "2026-08-24T12:00:00Z",
  "backup_timestamp": "2026-08-24T12:00:00Z",
  "verification_time": "2026-08-24T13:00:00+03:00",
  "verification_type": "quarterly-config-restore",
  "step_document": "ok",
  "overall_result": "success"
}
```

---

## RPO and RTO documentation

### Recovery Point Objective (non-DB assets)

**Target:** < 7 days (10080 minutes)

**Actual:** Recorded in each quarterly verification run's RPO field.

**Notes:**
- Configuration files change infrequently. Weekly backups provide adequate coverage.
- Highly sensitive secrets (API keys, database passwords) should use a secrets vault or external secret manager — file backup is a last-resort fallback.
- The backup script runs on every full backup cycle. Retention is 90 days by default.

### Recovery Time Objective (non-DB assets)

**Target:** < 30 minutes

**Actual:** Measured during each quarterly verification.

**Breakdown:**
| Step | Estimated time |
|---|---|
| Download encrypted backup from S3 | < 1 min (small archive) |
| Decrypt (GPG symmetric AES-256) | < 30 sec |
| Extract and verify | < 30 sec |
| Manual copy to production locations | < 5 min |
| Restart application / reload config | < 2 min |
| Verification and testing | < 10 min |
| **Total** | **< 20 min** |

### Measured values (updated per quarterly verification)

| Date | RTO | RPO | Verified by | Notes |
|---|---|---|---|---|
| *(first verification)* | | | | |

---

## Recovery scenarios

### Scenario A: Corrupted .env file

1. Restore the latest config backup to `/tmp/config-restore-test`
2. Copy `env-.env` to `.env`
3. Restart the application
4. Verify health endpoint

### Scenario B: Lost deployment scripts

1. Restore the latest config backup to `/tmp/config-restore-test`
2. Copy all `deploy-*` and `script-*` files to their original locations
3. Verify permissions (`chmod +x`)
4. Test deployment flow with `docker compose up -d`

### Scenario C: Lost TLS certificates (public certs only)

1. Restore the latest config backup
2. Copy `cert-*` files to the certificate directory
3. Verify certificate expiry dates
4. Restart services that use the certificates

**Note:** Private keys are not included in file backup. If private keys are lost and not stored in a secrets vault, re-issue certificates from the CA.

### Scenario D: Full config and file loss (disaster recovery)

1. Provision a new VM / container
2. Restore the PostgreSQL database first (see `restore-pg.sh` runbook)
3. Restore config files using this runbook
4. Verify application health
5. Measure and record actual RTO

---

## Troubleshooting

| Problem | Likely cause | Solution |
|---|---|---|
| `gpg: decryption failed: No secret key` | Wrong GPG key or passphrase | Verify `GPG_PASSPHRASE` is set correctly, or import the correct private key |
| S3 download fails with 403 | Wrong credentials | Verify `BACKUP_S3_ACCESS_KEY` and `BACKUP_S3_SECRET_KEY` |
| S3 download fails with 404 | Backup label is wrong or backup was pruned | List available backups and choose a valid label |
| No `config/` prefix in S3 bucket | Config backup has never been run | Run `backup-config.sh` first |
| tar extraction fails with CRC error | Backup file is corrupted | Download again; if still corrupt, the backup on S3 is damaged — use an earlier backup label |
| `.env` file restored contains old values | The backup was taken before a config change | Choose a backup label from after the change, or manually update the values |

---

## Maintenance

- **Quarterly verification:** Run `verify-restore-config.sh` every quarter and document the results.
- **Secret rotation:** When encryption keys or passphrases are rotated, run a fresh backup immediately.
- **Backup retention:** Config backups are retained for 90 days by default. Adjust `BACKUP_RETENTION_DAYS` in the backup job configuration.
- **Runbook review:** Review this runbook annually, or after any change to the backup/restore tooling.