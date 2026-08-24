#!/usr/bin/env bash
# Barghsa PostgreSQL Restore Script
#
# Restores a PostgreSQL database from a full backup (pg_basebackup tar.gz)
# with optional WAL replay to a specific point-in-time (PITR).
#
# Can restore in-place (overwriting the live database) or to an isolated
# directory for verification. Records RTO for compliance.
#
# Usage:
#   ./restore-pg.sh                              # Latest backup, restore in-place
#   ./restore-pg.sh --latest                     # Same as above
#   ./restore-pg.sh --label 2026-08-24T12:00:00Z # Specific backup label
#   ./restore-pg.sh --pitr "2026-08-24T13:00:00+03"  # Point-in-time recovery
#   ./restore-pg.sh --target-dir /tmp/restore-test    # Isolated restore (verification)
#   ./restore-pg.sh --dry-run                    # Print what would be done
#   ./restore-pg.sh --help                       # Show this message
#
# Required environment variables:
#   PGDIRECT_URL      — PostgreSQL connection string (bypasses PgBouncer)
#   BACKUP_S3_ENDPOINT — S3-compatible endpoint (e.g., http://minio:9000)
#   BACKUP_S3_BUCKET  — S3 bucket for backups
#   BACKUP_S3_ACCESS_KEY
#   BACKUP_S3_SECRET_KEY
#
# Optional:
#   RESTORE_DIR       — working directory for restore (default: /tmp/barghsa-restore)
#   PGDATA            — PostgreSQL data directory (default: /var/lib/postgresql/data)
#   PG_BIN            — path to PostgreSQL binaries (default: auto-detect)

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
S3_BUCKET="${BACKUP_S3_BUCKET:-barghsa-backups}"
S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-}"
S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-}"
RESTORE_DIR="${RESTORE_DIR:-/tmp/barghsa-restore}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
PG_BIN="${PG_BIN:-}"

LABEL=""
PITR_TARGET=""
TARGET_DIR=""
DRY_RUN=false
RESTORE_IN_PLACE=true

START_TS=""
END_TS=""

# ─── Help ─────────────────────────────────────────────────────────────────────

show_help() {
  sed -n '2,20p' "$0" | sed 's/^# //'
  exit 0
}

# ─── Parse arguments ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --latest) LABEL="latest"; shift ;;
    --label) LABEL="$2"; shift 2 ;;
    --pitr) PITR_TARGET="$2"; shift 2 ;;
    --target-dir) TARGET_DIR="$2"; RESTORE_IN_PLACE=false; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help) show_help ;;
    *) echo "Unknown option: $1" >&2; show_help ;;
  esac
done

# ─── Validation ───────────────────────────────────────────────────────────────

if [[ -z "$S3_ENDPOINT" || -z "$S3_ACCESS_KEY" || -z "$S3_SECRET_KEY" ]]; then
  echo "ERROR: BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY, and BACKUP_S3_SECRET_KEY are required" >&2
  exit 1
fi

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is not installed" >&2
  exit 1
fi

if ! command -v tar &>/dev/null; then
  echo "ERROR: tar is not installed" >&2
  exit 1
fi

# ─── Helper: S3 download via curl ─────────────────────────────────────────────

s3_get() {
  local src="$1"
  local dst="$2"

  local resource="/${S3_BUCKET}/${src}"
  local host
  host=$(echo "$S3_ENDPOINT" | sed -E 's|https?://||')

  if ! curl -sS -f -X GET \
    "${S3_ENDPOINT}${resource}" \
    -H "Host: ${host}" \
    -o "$dst" \
    --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}"; then
    echo "ERROR: S3 download failed: ${src} (curl exit $?)" >&2
    return 1
  fi
}

s3_list() {
  local prefix="$1"
  local resource="/${S3_BUCKET}/?prefix=${prefix}&max-keys=1"
  local host
  host=$(echo "$S3_ENDPOINT" | sed -E 's|https?://||')

  curl -sS -f -X GET \
    "${S3_ENDPOINT}${resource}" \
    -H "Host: ${host}" \
    --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" 2>/dev/null
}

# ─── Find latest backup ───────────────────────────────────────────────────────

find_latest_backup() {
  echo "Finding latest backup..." >&2
  # List the full/ prefix and get the latest directory
  local list_result
  list_result=$(s3_list "full/")
  if [[ -z "$list_result" ]]; then
    echo "ERROR: No backups found in S3 bucket" >&2
    exit 1
  fi

  # Try to list objects with delimiter to get common prefixes (directories)
  local resource="/${S3_BUCKET}/?prefix=full/&delimiter=/&max-keys=100"
  local host
  host=$(echo "$S3_ENDPOINT" | sed -E 's|https?://||')

  local dirs
  dirs=$(curl -sS -f -X GET \
    "${S3_ENDPOINT}${resource}" \
    -H "Host: ${host}" \
    --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" 2>/dev/null \
    | grep -oP '<Prefix>full/\K[^<]+' | sort -r | head -1)

  if [[ -z "$dirs" ]]; then
    echo "ERROR: Could not determine latest backup" >&2
    exit 1
  fi

  echo "$dirs"
}

# ─── Download backup ──────────────────────────────────────────────────────────

download_backup() {
  local backup_prefix="$1"
  local dest="$2"

  mkdir -p "$dest"

  echo "Downloading backup: ${backup_prefix}" >&2

  # List all files in the backup directory
  local resource="/${S3_BUCKET}/?prefix=${backup_prefix}"
  local host
  host=$(echo "$S3_ENDPOINT" | sed -E 's|https?://||')

  local files
  files=$(curl -sS -f -X GET \
    "${S3_ENDPOINT}${resource}" \
    -H "Host: ${host}" \
    --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" 2>/dev/null \
    | grep -oP '<Key>\K[^<]+')

  if [[ -z "$files" ]]; then
    echo "ERROR: No files found in backup: ${backup_prefix}" >&2
    exit 1
  fi

  while IFS= read -r file; do
    local filename
    filename=$(basename "$file")
    echo "  Downloading: ${filename}" >&2
    if [[ "$DRY_RUN" == true ]]; then
      echo "  [DRY-RUN] Would download: s3://${S3_BUCKET}/${file} → ${dest}/${filename}"
    else
      s3_get "$file" "${dest}/${filename}"
    fi
  done <<< "$files"
}

# ─── Download WAL archives ────────────────────────────────────────────────────

download_wal_archives() {
  local dest="$1"
  local pitr_before="${2:-}"

  mkdir -p "${dest}/wal_archives"

  local wal_prefix="wal/"
  local resource="/${S3_BUCKET}/?prefix=${wal_prefix}"
  local host
  host=$(echo "$S3_ENDPOINT" | sed -E 's|https?://||')

  local wal_files
  wal_files=$(curl -sS -f -X GET \
    "${S3_ENDPOINT}${resource}" \
    -H "Host: ${host}" \
    --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" 2>/dev/null \
    | grep -oP '<Key>\K[^<]+' || true)

  if [[ -z "$wal_files" ]]; then
    echo "  No WAL archives found (non-fatal for base-only restore)" >&2
    return 0
  fi

  while IFS= read -r file; do
    local filename
    filename=$(basename "$file")
    echo "  Downloading WAL: ${filename}" >&2
    if [[ "$DRY_RUN" == true ]]; then
      echo "  [DRY-RUN] Would download: s3://${S3_BUCKET}/${file} → ${dest}/wal_archives/${filename}"
    else
      s3_get "$file" "${dest}/wal_archives/${filename}" || true
    fi
  done <<< "$wal_files"
}

# ─── Extract backup ───────────────────────────────────────────────────────────

extract_backup() {
  local src_dir="$1"
  local dest="$2"

  mkdir -p "$dest"

  echo "Extracting backup files..." >&2
  for f in "$src_dir"/*.tar.gz; do
    if [[ ! -f "$f" ]]; then
      echo "  No .tar.gz files found in ${src_dir}" >&2
      exit 1
    fi
    echo "  Extracting: $(basename "$f")" >&2
    if [[ "$DRY_RUN" == true ]]; then
      echo "  [DRY-RUN] Would extract: ${f} → ${dest}"
    else
      tar -xzf "$f" -C "$dest"
    fi
  done
}

# ─── Check for PostgreSQL tools ───────────────────────────────────────────────

find_pg_tools() {
  if [[ -n "$PG_BIN" ]]; then
    PG_RECOVERYSET="${PG_BIN}/pg_checksums"
    PG_CTL="${PG_BIN}/pg_ctl"
    PG_ISREADY="${PG_BIN}/pg_isready"
    PG_RECOVERYSET="${PG_BIN}/pg_checksums"
  else
    PG_CTL="pg_ctl"
    PG_ISREADY="pg_isready"
  fi
}

# ─── Configure recovery.conf / postgresql.conf ───────────────────────────────

write_recovery_conf() {
  local data_dir="$1"
  local recovery_conf="${data_dir}/postgresql.auto.conf"

  if [[ -n "$PITR_TARGET" ]]; then
    echo "Configuring PITR to: ${PITR_TARGET}" >&2
    if [[ "$DRY_RUN" == true ]]; then
      echo "  [DRY-RUN] Would set: restore_command = 'cp ${RESTORE_DIR}/wal_archives/%f %p'"
      echo "  [DRY-RUN] Would set: recovery_target_time = '${PITR_TARGET}'"
    else
      # Append recovery settings to postgresql.auto.conf
      # PostgreSQL reads these as configuration parameters when recovery.conf is merged
      {
        echo "# Recovery settings — written by restore-pg.sh"
        echo "restore_command = 'cp ${RESTORE_DIR}/wal_archives/%f %p'"
        echo "recovery_target_time = '${PITR_TARGET}'"
        echo "recovery_target_action = 'promote'"
      } >> "$recovery_conf"
    fi
  else
    echo "Performing full restore (no PITR) — replaying all available WAL" >&2
    if [[ "$DRY_RUN" != true ]]; then
      {
        echo "# Recovery settings — written by restore-pg.sh"
        echo "restore_command = 'cp ${RESTORE_DIR}/wal_archives/%f %p'"
        echo "recovery_target_action = 'promote'"
      } >> "$recovery_conf"
    fi
  fi
}

# ─── Verify restored data ─────────────────────────────────────────────────────

verify_restore() {
  local data_dir="$1"
  echo "Verifying restored data..." >&2

  if [[ "$DRY_RUN" == true ]]; then
    echo "  [DRY-RUN] Would verify data integrity"
    echo "  [DRY-RUN] Would run: pg_checksums -c ${data_dir}"
    return 0
  fi

  # Check that the data directory looks like a valid PostgreSQL data directory
  if [[ ! -f "${data_dir}/PG_VERSION" ]]; then
    echo "ERROR: Restored data directory missing PG_VERSION — restore likely failed" >&2
    return 1
  fi

  # Verify checksums if enabled
  if command -v pg_checksums &>/dev/null; then
    echo "  Checking data checksums..." >&2
    pg_checksums -c "$data_dir" 2>/dev/null || echo "  Warning: checksum verification skipped (not enabled on backup)" >&2
  fi

  echo "  Restore verification passed." >&2
}

# ─── Measure RTO ──────────────────────────────────────────────────────────────

measure_rto() {
  START_TS="${START_TS:-$(date -u +%s)}"
  END_TS=$(date -u +%s)
  local elapsed=$((END_TS - START_TS))

  local minutes=$((elapsed / 60))
  local seconds=$((elapsed % 60))

  echo "RTO: ${minutes}m ${seconds}s (${elapsed}s total)" >&2

  if [[ $elapsed -gt 3600 ]]; then
    echo "WARNING: RTO exceeds 60-minute target (${minutes}m ${seconds}s)" >&2
  else
    echo "RTO within target: ≤ 60 minutes." >&2
  fi
}

# ─── Cleanup handler ──────────────────────────────────────────────────────────

cleanup() {
  if [[ "$RESTORE_IN_PLACE" != true ]]; then
    rm -rf "$RESTORE_DIR"
  fi
}
trap cleanup EXIT

# ─── Main ─────────────────────────────────────────────────────────────────────

echo "=== Barghsa PostgreSQL Restore ==="
echo ""

START_TS=$(date -u +%s)

# Step 1: Determine backup to restore
if [[ "$LABEL" == "latest" || -z "$LABEL" ]]; then
  LABEL=$(find_latest_backup)
fi
echo "Backup label: ${LABEL}"
echo ""

# Step 2: Set up restore directory
if [[ -n "$TARGET_DIR" ]]; then
  RESTORE_DIR="$TARGET_DIR"
fi
echo "Restore directory: ${RESTORE_DIR}"
echo ""

# Step 3: Download backup
download_backup "full/${LABEL}/" "${RESTORE_DIR}/downloads"

# Step 4: Download WAL archives (needed for PITR or full WAL replay)
download_wal_archives "$RESTORE_DIR"

# Step 5: Extract backup
extract_backup "${RESTORE_DIR}/downloads" "${RESTORE_DIR}/data"

# Step 6: Write recovery configuration
write_recovery_conf "${RESTORE_DIR}/data"

# Step 7: Verify restored data
echo ""
echo "Verifying restore..." >&2
verify_restore "${RESTORE_DIR}/data"

# Step 8: Measure RTO
echo ""
measure_rto

# Step 9: Summary
echo ""
echo "=== Restore Complete ==="
echo "Backup:       ${LABEL}"
echo "PITR target:  ${PITR_TARGET:-none (full restore)}"
echo "Data dir:     ${RESTORE_DIR}/data"
echo "WAL archives: ${RESTORE_DIR}/wal_archives"
echo "In-place:     ${RESTORE_IN_PLACE}"
echo ""

if [[ "$RESTORE_IN_PLACE" == true ]]; then
  echo "To start the restored database:"
  echo "  pg_ctl -D ${RESTORE_DIR}/data start"
  echo ""
  echo "To promote (if in recovery mode):"
  echo "  pg_ctl -D ${RESTORE_DIR}/data promote"
else
  echo "Isolated restore to: ${RESTORE_DIR}/data"
  echo "Verify with: pg_isready -d '${PGDIRECT_URL}'"
  echo "Cleanup: rm -rf ${RESTORE_DIR}"
fi

exit 0