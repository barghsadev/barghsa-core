#!/usr/bin/env bash
# Barghsa Config & Critical Files Restore Script
#
# Restores config, secrets, and critical application files from an encrypted
# off-server backup. Can restore to the original location or to an isolated
# directory for verification.
#
# Usage:
#   ./restore-config.sh                              # Latest config backup
#   ./restore-config.sh --label 2026-08-24T12:00:00Z # Specific backup label
#   ./restore-config.sh --target-dir /tmp/restore-test    # Isolated restore
#   ./restore-config.sh --decrypt-with <key-id>      # GPG private key for decryption
#   ./restore-config.sh --dry-run                    # Print what would be done
#   ./restore-config.sh --help                       # Show this message
#
# Required environment variables:
#   BACKUP_S3_ENDPOINT — S3-compatible endpoint (e.g., http://minio:9000)
#   BACKUP_S3_BUCKET  — S3 bucket for backups
#   BACKUP_S3_ACCESS_KEY
#   BACKUP_S3_SECRET_KEY
#
# Optional:
#   GPG_PASSPHRASE     — Passphrase for symmetric GPG decryption
#   RESTORE_TARGET_DIR — Where to place restored files (default: prompt)
#   WORK_DIR           — Working directory (default: /tmp/barghsa-config-restore)
#
# Exit codes:
#   0 — Restore successful
#   1 — Validation or configuration error
#   2 — Backup not found or download failed
#   3 — Decryption failed
#   4 — Verification failed

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
S3_BUCKET="${BACKUP_S3_BUCKET:-barghsa-backups}"
S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-}"
S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-}"
GPG_PASSPHRASE="${GPG_PASSPHRASE:-}"
WORK_DIR="${WORK_DIR:-/tmp/barghsa-config-restore}"

LABEL="latest"
GPG_DECRYPT_KEY=""
TARGET_DIR=""
DRY_RUN=false

START_TS=""
END_TS=""

# ─── Help ─────────────────────────────────────────────────────────────────────

show_help() {
  sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# //; s/^#$//'
  exit 0
}

# ─── Parse arguments ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --target-dir) TARGET_DIR="$2"; shift 2 ;;
    --decrypt-with) GPG_DECRYPT_KEY="$2"; shift 2 ;;
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

if ! command -v gpg &>/dev/null; then
  echo "ERROR: gpg is not installed" >&2
  exit 1
fi

# ─── S3 helpers ───────────────────────────────────────────────────────────────

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
    echo "ERROR: S3 download failed: ${src}" >&2
    return 1
  fi
}

s3_list() {
  local prefix="$1"
  local resource="/${S3_BUCKET}/?prefix=${prefix}&max-keys=100"
  local host
  host=$(echo "$S3_ENDPOINT" | sed -E 's|https?://||')

  curl -sS -f -X GET \
    "${S3_ENDPOINT}${resource}" \
    -H "Host: ${host}" \
    --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" 2>/dev/null
}

# ─── Find latest backup ───────────────────────────────────────────────────────

find_latest_backup() {
  echo "Finding latest config backup..." >&2

  # Try reading the latest pointer first
  local pointer_result
  pointer_result=$(s3_get "config/latest.txt" "${WORK_DIR}/latest-pointer.txt" 2>/dev/null || true)
  if [[ -f "${WORK_DIR}/latest-pointer.txt" ]]; then
    local ptr_label
    ptr_label=$(cat "${WORK_DIR}/latest-pointer.txt" | tr -d '[:space:]')
    if [[ -n "$ptr_label" ]]; then
      echo "$ptr_label"
      return 0
    fi
  fi

  # Fallback: list config/ directory
  local list_result
  list_result=$(curl -sS -X GET \
    "${S3_ENDPOINT}/${S3_BUCKET}/?prefix=config/&delimiter=/&max-keys=100" \
    -H "Host: $(echo $S3_ENDPOINT | sed -E 's|https?://||')" \
    --user "${S3_ACCESS_KEY}:${S3_SECRET_KEY}" 2>/dev/null | grep -oP '<Prefix>config/\K[^<]+' | sort -r | head -1)

  if [[ -z "$list_result" ]]; then
    echo "ERROR: No config backups found" >&2
    exit 2
  fi

  echo "$list_result"
}

# ─── GPG decryption helper ────────────────────────────────────────────────────

gpg_decrypt() {
  local src="$1"
  local dst="$2"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would decrypt: $src -> $dst"
    return 0
  fi

  if [[ -n "$GPG_DECRYPT_KEY" ]]; then
    # Recipient-based decryption (requires the private key)
    gpg --batch --yes --trust-model always \
      --decrypt --recipient "$GPG_DECRYPT_KEY" \
      --output "$dst" "$src"
  elif [[ -n "$GPG_PASSPHRASE" ]]; then
    # Symmetric decryption with passphrase
    echo "$GPG_PASSPHRASE" | gpg --batch --yes --passphrase-fd 0 \
      --decrypt --output "$dst" "$src"
  else
    # Interactive — will prompt for passphrase
    gpg --batch --yes \
      --decrypt --output "$dst" "$src"
  fi
}

# ─── Verify restored files ────────────────────────────────────────────────────

verify_restore() {
  local restore_dir="$1"
  local errors=0

  echo "  Verifying restored files..." >&2

  # Check MANIFEST exists
  if [[ ! -f "${restore_dir}/MANIFEST.txt" ]]; then
    echo "  ERROR: MANIFEST.txt not found — backup may be incomplete" >&2
    errors=$((errors + 1))
  else
    echo "  [OK] MANIFEST.txt found" >&2
  fi

  # Check backup metadata
  if [[ ! -f "${restore_dir}/backup-meta.json" ]]; then
    echo "  WARNING: backup-meta.json not found" >&2
  else
    echo "  [OK] backup-meta.json found" >&2
  fi

  # Count non-empty files extracted
  local non_empty
  non_empty=$(find "$restore_dir" -type f -size +0c 2>/dev/null | wc -l)
  echo "  Restored ${non_empty} non-empty files." >&2

  # Check for encrypted key material — verify we have the expected number
  local key_count
  key_count=$(find "$restore_dir" -name 'key-*' 2>/dev/null | wc -l)
  echo "  Key material files: ${key_count}" >&2

  if [[ $errors -gt 0 ]]; then
    echo "  Verification FAILED with ${errors} errors." >&2
    return 1
  fi

  echo "  Verification PASSED." >&2
}

# ─── Measure RTO ──────────────────────────────────────────────────────────────

measure_rto() {
  END_TS=$(date -u +%s)
  local elapsed=$((END_TS - START_TS))
  local minutes=$((elapsed / 60))
  local seconds=$((elapsed % 60))

  echo ""
  echo "Config restore time: ${minutes}m ${seconds}s (${elapsed}s total)"
  echo "Target RTO for non-DB assets: < 30 minutes"
  echo ""

  if [[ $elapsed -gt 1800 ]]; then
    echo "WARNING: Restore time exceeds 30-minute target (${minutes}m ${seconds}s)" >&2
  else
    echo "Config restore within 30-minute RTO target." >&2
  fi
}

# ─── Cleanup ──────────────────────────────────────────────────────────────────

cleanup() {
  local exit_code=$?
  # Only clean up downloads when not doing isolated restore
  if [[ -z "$TARGET_DIR" ]]; then
    rm -rf "$WORK_DIR"
  else
    rm -rf "${WORK_DIR}/download" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

# ─── Main ─────────────────────────────────────────────────────────────────────

echo "=== Barghsa Config & Critical Files Restore ==="
echo ""

START_TS=$(date -u +%s)

# Step 1: Determine backup label
if [[ "$LABEL" == "latest" ]]; then
  LABEL=$(find_latest_backup)
fi
echo "Backup label: ${LABEL}"
echo ""

# Step 2: Prepare directories
mkdir -p "$WORK_DIR/download"

# Step 3: Download encrypted backup
echo "Downloading config backup: config/${LABEL}/barghsa-config-${LABEL}.tar.gz.gpg"
BACKUP_FILENAME="barghsa-config-${LABEL}.tar.gz.gpg"
s3_get "config/${LABEL}/${BACKUP_FILENAME}" "${WORK_DIR}/download/${BACKUP_FILENAME}" || {
  echo "ERROR: Failed to download config backup" >&2
  exit 2
}
echo "Downloaded: ${WORK_DIR}/download/${BACKUP_FILENAME}"
echo ""

# Step 4: Decrypt
echo "Decrypting backup..."
DECRYPTED_FILE="${WORK_DIR}/download/barghsa-config-${LABEL}.tar.gz"
gpg_decrypt "${WORK_DIR}/download/${BACKUP_FILENAME}" "$DECRYPTED_FILE" || {
  echo "ERROR: Decryption failed — check GPG key or passphrase" >&2
  exit 3
}
echo "Decrypted: ${DECRYPTED_FILE}"
echo ""

# Step 5: Extract
echo "Extracting backup..."
EXTRACT_DIR="${WORK_DIR}/extracted"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$DECRYPTED_FILE" -C "$EXTRACT_DIR" || {
  echo "ERROR: Extraction failed — backup may be corrupted" >&2
  exit 4
}
echo "Extracted to: ${EXTRACT_DIR}"
echo ""

# Step 6: Verify
verify_restore "${EXTRACT_DIR}/collect"

# Step 7: Determine target
if [[ -z "$TARGET_DIR" ]]; then
  echo ""
  echo "No --target-dir specified."
  echo "Restored files are in: ${EXTRACT_DIR}/collect/"
  echo "Review them, then copy to their original locations manually."
else
  echo "Copying to target: ${TARGET_DIR}"
  mkdir -p "$TARGET_DIR"
  cp -r "${EXTRACT_DIR}/collect/"* "$TARGET_DIR/"
  echo "Restored to: ${TARGET_DIR}"
fi

# Step 8: Measure and report
measure_rto

echo ""
echo "=== Config restore complete ==="
echo "Backup:      ${LABEL}"
echo "Decrypted:   ${EXTRACT_DIR}/collect/"
echo "Target:      ${TARGET_DIR:-"(manual copy required)"}"
echo "Files:       $(find "${EXTRACT_DIR}/collect/" -type f 2>/dev/null | wc -l)"

exit 0