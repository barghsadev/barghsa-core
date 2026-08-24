#!/usr/bin/env bash
# Barghsa PostgreSQL WAL Archiving Script
#
# Designed to be used as PostgreSQL's archive_command. Archives each
# completed WAL segment to S3/MinIO object storage.
#
# Usage (in postgresql.conf):
#   archive_command = '/path/to/archive-wal.sh %f %p'
#
# Where %f is the WAL segment filename and %p is the full path.
#
# Required environment variables:
#   BACKUP_S3_ENDPOINT — S3-compatible endpoint
#   BACKUP_S3_BUCKET  — S3 bucket for WAL archives (default: barghsa-backups)
#   BACKUP_S3_ACCESS_KEY
#   BACKUP_S3_SECRET_KEY
#
# Optional:
#   WAL_RETENTION_DAYS — WAL segments older than this are candidates for cleanup
#                        (default: 7). Actual cleanup is done by the backup script.

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-barghsa-backups}"
BACKUP_S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-}"
BACKUP_S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-}"

WAL_FILENAME="${1:-}"
WAL_FILEPATH="${2:-}"

# ─── Validation ───────────────────────────────────────────────────────────────

if [[ -z "$WAL_FILENAME" || -z "$WAL_FILEPATH" ]]; then
  echo "ERROR: Usage: archive-wal.sh <wal_filename> <wal_filepath>" >&2
  exit 1
fi

if [[ ! -f "$WAL_FILEPATH" ]]; then
  echo "ERROR: WAL file not found: $WAL_FILEPATH" >&2
  exit 1
fi

if [[ -z "$BACKUP_S3_ENDPOINT" || -z "$BACKUP_S3_ACCESS_KEY" || -z "$BACKUP_S3_SECRET_KEY" ]]; then
  echo "ERROR: BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY, and BACKUP_S3_SECRET_KEY are required" >&2
  exit 1
fi

# ─── Upload WAL segment ───────────────────────────────────────────────────────

# Path in S3: wal/<YYYY-MM-DD>/<segment>
WAL_DATE=$(date -u +%Y-%m-%d)
S3_PATH="wal/${WAL_DATE}/${WAL_FILENAME}"

resource="/${BACKUP_S3_BUCKET}/${S3_PATH}"
host=$(echo "$BACKUP_S3_ENDPOINT" | sed -E 's|https?://||')

curl -s -X PUT \
  "${BACKUP_S3_ENDPOINT}${resource}" \
  -H "Host: ${host}" \
  -H "Content-Type: application/octet-stream" \
  -T "$WAL_FILEPATH" \
  --user "${BACKUP_S3_ACCESS_KEY}:${BACKUP_S3_SECRET_KEY}"

echo "[$(date -u +%H:%M:%S)] Archived WAL: ${WAL_FILENAME} → ${S3_PATH}" >&2

exit 0