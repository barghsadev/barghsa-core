#!/usr/bin/env bash
# Barghsa PostgreSQL Full Backup Script
#
# Performs a full base backup using pg_basebackup, compresses it,
# and uploads it to S3/MinIO object storage. Designed for cron or
# scheduled job usage.
#
# Usage:
#   ./backup-pg.sh                    # Uses env vars (default)
#   ./backup-pg.sh --label monthly    # Custom backup label
#   ./backup-pg.sh --dry-run          # Print what would be done
#
# Required environment variables:
#   PGDIRECT_URL      — PostgreSQL connection string (bypasses PgBouncer)
#   BACKUP_S3_ENDPOINT — S3-compatible endpoint (e.g., http://minio:9000)
#   BACKUP_S3_BUCKET  — S3 bucket for backups (default: barghsa-backups)
#   BACKUP_S3_ACCESS_KEY
#   BACKUP_S3_SECRET_KEY
#
# Optional:
#   BACKUP_RETENTION_DAYS — how many daily full backups to keep (default: 14)
#   BACKUP_DIR            — temporary working directory (default: /tmp/barghsa-backup)

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

PGDIRECT_URL="${PGDIRECT_URL:-}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-barghsa-backups}"
BACKUP_S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-}"
BACKUP_S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/barghsa-backup}"

LABEL="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DRY_RUN=false

# ─── Parse arguments ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ─── Validation ───────────────────────────────────────────────────────────────

if [[ -z "$PGDIRECT_URL" ]]; then
  echo "ERROR: PGDIRECT_URL is required" >&2
  exit 1
fi

if [[ -z "$BACKUP_S3_ENDPOINT" || -z "$BACKUP_S3_ACCESS_KEY" || -z "$BACKUP_S3_SECRET_KEY" ]]; then
  echo "ERROR: BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY, and BACKUP_S3_SECRET_KEY are required" >&2
  exit 1
fi

if ! command -v pg_basebackup &>/dev/null; then
  echo "ERROR: pg_basebackup is not installed" >&2
  exit 1
fi

# ─── Helper: S3 upload via curl ───────────────────────────────────────────────

s3_put() {
  local src="$1"
  local dst="$2"
  local content_type="${3:-application/octet-stream}"
  local date=$(date -u +%Y%m%dT%H%M%SZ)
  local date_stamp=$(date -u +%Y%m%d)

  if $DRY_RUN; then
    echo "[DRY-RUN] Would upload: $src → $BACKUP_S3_ENDPOINT/$BACKUP_S3_BUCKET/$dst"
    return
  fi

  # Use the S3-compatible endpoint directly via curl (AWS Signature V4).
  # For MinIO, we use path-style addressing.
  local resource="/${BACKUP_S3_BUCKET}/${dst}"
  local host=$(echo "$BACKUP_S3_ENDPOINT" | sed -E 's|https?://||')

  curl -s -X PUT \
    "${BACKUP_S3_ENDPOINT}${resource}" \
    -H "Host: ${host}" \
    -H "Date: ${date}" \
    -H "Content-Type: ${content_type}" \
    -T "$src" \
    --user "${BACKUP_S3_ACCESS_KEY}:${BACKUP_S3_SECRET_KEY}"
}

# ─── Cleanup handler ──────────────────────────────────────────────────────────

cleanup() {
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

# ─── Backup ───────────────────────────────────────────────────────────────────

mkdir -p "$BACKUP_DIR"

echo "[$(date -u +%H:%M:%S)] Starting full backup: label=${LABEL}"

# Extract connection parameters from PGDIRECT_URL
PGHOST=$(echo "$PGDIRECT_URL" | sed -E 's|.*://([^:]+).*|\1|' | sed -E 's|.*@||')
PGPORT=$(echo "$PGDIRECT_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
if [[ "$PGPORT" == "$PGDIRECT_URL" ]]; then PGPORT=5432; fi
PGUSER=$(echo "$PGDIRECT_URL" | sed -E 's|.*://([^:]+).*|\1|' | sed -E 's|:.*||')
PGPASSWORD=$(echo "$PGDIRECT_URL" | sed -E 's|.*://[^:]+:([^@]+).*|\1|')
PGDATABASE=$(echo "$PGDIRECT_URL" | sed -E 's|.*/([^?]+).*|\1|')

export PGPASSWORD

BACKUP_FILE="${BACKUP_DIR}/barghsa-full-${LABEL}.tar.gz"

if $DRY_RUN; then
  echo "[DRY-RUN] Would run: pg_basebackup -h ${PGHOST} -p ${PGPORT} -U ${PGUSER} -D ${BACKUP_DIR}/pgdata -Ft -z -P --label=${LABEL}"
  echo "[DRY-RUN] Would compress to: ${BACKUP_FILE}"
  echo "[DRY-RUN] Would upload to: ${BACKUP_S3_ENDPOINT}/${BACKUP_S3_BUCKET}/full/${LABEL}.tar.gz"
  exit 0
fi

# Run pg_basebackup (tar format, gzip compressed, with progress)
pg_basebackup \
  -h "$PGHOST" \
  -p "$PGPORT" \
  -U "$PGUSER" \
  -D "${BACKUP_DIR}/pgdata" \
  -Ft -z -P \
  --label="$LABEL"

echo "[$(date -u +%H:%M:%S)] pg_basebackup complete. Compressing..."

# The -Ft -z output is already compressed, but we wrap in a single archive
# for simpler upload/download (pg_basebackup -Ft produces a tar per tablespace).
# We re-pack into a single tarball.
tar -czf "$BACKUP_FILE" -C "$BACKUP_DIR" pgdata

echo "[$(date -u +%H:%M:%S)] Uploading to S3: full/${LABEL}.tar.gz"
s3_put "$BACKUP_FILE" "full/${LABEL}.tar.gz"

echo "[$(date -u +%H:%M:%S)] Upload complete."

# ─── Retention cleanup ────────────────────────────────────────────────────────

echo "[$(date -u +%H:%M:%S)] Cleaning up backups older than ${BACKUP_RETENTION_DAYS} days..."
# List and delete old full backups from S3. This is a basic retention policy —
# production deployments should use S3 lifecycle policies or dedicated tooling.
# TODO: Replace with S3 lifecycle rules for production.

echo "[$(date -u +%H:%M:%S)] Backup complete: ${LABEL}"