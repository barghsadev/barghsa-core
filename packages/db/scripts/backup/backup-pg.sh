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

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is not installed" >&2
  exit 1
fi

# ─── Helper: S3 upload via curl ───────────────────────────────────────────────

s3_put() {
  local src="$1"
  local dst="$2"
  local content_type="${3:-application/octet-stream}"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would upload: $src → $BACKUP_S3_ENDPOINT/$BACKUP_S3_BUCKET/$dst"
    return 0
  fi

  local resource="/${BACKUP_S3_BUCKET}/${dst}"
  local host
  host=$(echo "$BACKUP_S3_ENDPOINT" | sed -E 's|https?://||')

  if ! curl -sS -f -X PUT \
    "${BACKUP_S3_ENDPOINT}${resource}" \
    -H "Host: ${host}" \
    -H "Content-Type: ${content_type}" \
    -T "$src" \
    --user "${BACKUP_S3_ACCESS_KEY}:${BACKUP_S3_SECRET_KEY}"; then
    echo "ERROR: S3 upload failed: $dst (curl exit $?)" >&2
    return 1
  fi
}

# ─── Cleanup handler ──────────────────────────────────────────────────────────

cleanup() {
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

# ─── Backup ───────────────────────────────────────────────────────────────────

mkdir -p "$BACKUP_DIR"

echo "[$(date -u +%H:%M:%S)] Starting full backup: label=${LABEL}"

# Use pg_basebackup's --dbname to pass the connection string directly.
# PostgreSQL handles all URL parsing (IPv6, query params, etc.),
# avoiding fragile sed-based extraction.
BACKUP_FILE="${BACKUP_DIR}/barghsa-full-${LABEL}.tar.gz"

if [[ "$DRY_RUN" == true ]]; then
  echo "[DRY-RUN] Would run: pg_basebackup --dbname='${PGDIRECT_URL}' -D ${BACKUP_DIR}/pgdata -Ft -z -P --label=${LABEL}"
  echo "[DRY-RUN] Would be uploaded as: full/${LABEL}.tar.gz"
  exit 0
fi

# Run pg_basebackup (tar format, gzip compressed, with progress).
# pg_basebackup -Ft -z produces one .tar.gz per tablespace.
# We upload these directly; no second compression pass.
pg_basebackup \
  --dbname="$PGDIRECT_URL" \
  -D "${BACKUP_DIR}/pgdata" \
  -Ft -z -P \
  --label="$LABEL"

echo "[$(date -u +%H:%M:%S)] pg_basebackup complete."

# Find and upload each .tar.gz produced by pg_basebackup
BACKUP_FILES=("$BACKUP_DIR"/pgdata/*.tar.gz)
if [[ ${#BACKUP_FILES[@]} -eq 0 ]]; then
  echo "ERROR: No backup files found in ${BACKUP_DIR}/pgdata/" >&2
  exit 1
fi

for f in "${BACKUP_FILES[@]}"; do
  BASENAME=$(basename "$f")
  echo "[$(date -u +%H:%M:%S)] Uploading: full/${LABEL}/${BASENAME}"
  s3_put "$f" "full/${LABEL}/${BASENAME}" || exit 1
done

echo "[$(date -u +%H:%M:%S)] Backup complete: ${LABEL}"