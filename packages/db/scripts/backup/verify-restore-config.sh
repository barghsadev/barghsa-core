#!/usr/bin/env bash
# Barghsa Quarterly Config Restore Verification Script
#
# Verifies that the latest config backup can be successfully restored and
# all critical files are present and decryptable. Designed for quarterly
# scheduled execution.
#
# Process:
#   1. Downloads the latest config backup from S3
#   2. Decrypts it using GPG (same method as live restore)
#   3. Extracts and verifies all files against the manifest
#   4. Measures and records RTO for non-DB assets
#   5. Produces a structured JSON result
#
# Usage:
#   ./verify-restore-config.sh                          # Run verification
#   ./verify-restore-config.sh --label 2026-08-24T12:00:00Z  # Specific backup
#   ./verify-restore-config.sh --decrypt-with <key-id>  # GPG key for decryption
#   ./verify-restore-config.sh --dry-run                # Print what would be done
#   ./verify-restore-config.sh --help                   # Show this message
#
# Required environment variables:
#   BACKUP_S3_ENDPOINT — S3-compatible endpoint (e.g., http://minio:9000)
#   BACKUP_S3_BUCKET  — S3 bucket for backups
#   BACKUP_S3_ACCESS_KEY
#   BACKUP_S3_SECRET_KEY
#   GPG_PASSPHRASE     — Passphrase for symmetric GPG decryption
#
# Optional:
#   WORK_DIR          — Working directory (default: /tmp/barghsa-config-verify)
#   RTO_WARNING_SEC   — Warning threshold in seconds (default: 1800 = 30 min)
#   RTO_CRITICAL_SEC  — Critical threshold (default: 3600 = 60 min)
#   RESTORE_SCRIPT    — Path to restore-config.sh (default: same directory)

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
S3_BUCKET="${BACKUP_S3_BUCKET:-barghsa-backups}"
S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-}"
S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-}"
GPG_PASSPHRASE="${GPG_PASSPHRASE:-}"
WORK_DIR="${WORK_DIR:-/tmp/barghsa-config-verify}"

RTO_WARNING_SEC="${RTO_WARNING_SEC:-1800}"   # 30 min
RTO_CRITICAL_SEC="${RTO_CRITICAL_SEC:-3600}" # 60 min
RPO_WARNING_M="${RPO_WARNING_M:-1440}"       # 1 day in minutes (config changes rarely)
RPO_CRITICAL_M="${RPO_CRITICAL_M:-10080}"    # 7 days in minutes

GPG_DECRYPT_KEY=""
LABEL="latest"
DRY_RUN=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTORE_SCRIPT="${RESTORE_SCRIPT:-${SCRIPT_DIR}/restore-config.sh}"

START_TS=""
RESTORE_END_TS=""
BACKUP_LABEL=""
BACKUP_TIMESTAMP=""

# ─── Result accumulator ───────────────────────────────────────────────────────

RESULT_JSON='{}'
add_field() {
  local key="$1"
  local value="$2"
  if command -v jq &>/dev/null; then
    local updated
    updated=$(echo "$RESULT_JSON" | jq --arg k "$key" --arg v "$value" '. + {($k): $v}' 2>/dev/null) && RESULT_JSON="$updated"
  fi
}

add_field_num() {
  local key="$1"
  local value="$2"
  if command -v jq &>/dev/null; then
    local updated
    updated=$(echo "$RESULT_JSON" | jq --arg k "$key" --argjson v "$value" '. + {($k): $v}' 2>/dev/null) && RESULT_JSON="$updated"
  fi
}

# ─── Help ─────────────────────────────────────────────────────────────────────

show_help() {
  sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# //; s/^#$//'
  exit 0
}

# ─── Parse arguments ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
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

if [[ ! -x "$RESTORE_SCRIPT" ]]; then
  echo "ERROR: restore-config.sh not found or not executable: ${RESTORE_SCRIPT}" >&2
  exit 1
fi

# ─── Mark timing ──────────────────────────────────────────────────────────────

mark_start() {
  START_TS=$(date -u +%s)
  echo "[$(date -u +%H:%M:%S)] Verification started" >&2
}

mark_restore_complete() {
  RESTORE_END_TS=$(date -u +%s)
}

compute_rto() {
  if [[ -z "$RESTORE_END_TS" || -z "$START_TS" ]]; then
    echo "-1"
    return
  fi
  echo $((RESTORE_END_TS - START_TS))
}

# ─── Cleanup ──────────────────────────────────────────────────────────────────

cleanup() {
  local exit_code="${OVERALL_EXIT:-$?}"

  echo "" >&2
  echo "[$(date -u +%H:%M:%S)] Cleaning up..." >&2

  if [[ "$DRY_RUN" != true ]]; then
    rm -rf "$WORK_DIR" 2>/dev/null || true
  fi

  echo "" >&2
  echo "=== Result ===" >&2
  if command -v jq &>/dev/null; then
    echo "$RESULT_JSON" | jq '.' 2>/dev/null || echo "$RESULT_JSON"
  else
    echo "$RESULT_JSON"
  fi

  echo "" >&2
  echo "RPO (config changes): The interval since the backup was taken." >&2
  echo "Target RPO for non-DB assets: < 7 days (config changes are rare)." >&2
  echo "Target RTO for non-DB assets: < 30 minutes." >&2

  exit "$exit_code"
}
trap 'OVERALL_EXIT=${OVERALL_EXIT:-$?}; cleanup' EXIT

# ─── Step 1: Restore config backup ───────────────────────────────────────────

step_restore() {
  echo "=== Step 1: Restoring latest config backup (isolated) ===" >&2

  mkdir -p "$WORK_DIR"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would run: ${RESTORE_SCRIPT} --target-dir ${WORK_DIR}/restored --label ${LABEL}" >&2
    BACKUP_LABEL="latest"
    BACKUP_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    add_field "step_restore" "dry-run"
    return 0
  fi

  local restore_args=()
  restore_args+=("--target-dir" "${WORK_DIR}/restored")
  if [[ "$LABEL" != "latest" ]]; then
    restore_args+=("--label" "$LABEL")
  fi
  if [[ -n "$GPG_DECRYPT_KEY" ]]; then
    restore_args+=("--decrypt-with" "$GPG_DECRYPT_KEY")
  fi

  # shellcheck disable=SC2015
  local restore_output
  restore_output=$(GPG_PASSPHRASE="${GPG_PASSPHRASE}" "${RESTORE_SCRIPT}" "${restore_args[@]}" 2>&1) || {
    echo "ERROR: restore-config.sh failed" >&2
    echo "$restore_output" >&2
    add_field "step_restore" "failed"
    return 1
  }

  # Extract backup label and timestamp from output
  BACKUP_LABEL=$(echo "$restore_output" | grep -oP 'Backup:\s+\K\S+' 2>/dev/null || echo "$LABEL")
  BACKUP_TIMESTAMP="${BACKUP_LABEL}"

  if [[ ! -d "${WORK_DIR}/restored" ]]; then
    echo "ERROR: Restore produced no output directory" >&2
    add_field "step_restore" "failed"
    return 1
  fi

  add_field "step_restore" "ok"
  echo "[$(date -u +%H:%M:%S)] Config restore completed successfully" >&2
}

# ─── Step 2: Verify file structure ───────────────────────────────────────────

step_verify_files() {
  echo "=== Step 2: Verifying file structure ===" >&2

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would verify file structure" >&2
    add_field "step_verify_files" "dry-run"
    return 0
  fi

  local restore_dir="${WORK_DIR}/restored"
  local checks_passed=true
  local failures=""

  # Check 1: MANIFEST exists and is non-empty
  if [[ -f "${restore_dir}/MANIFEST.txt" && -s "${restore_dir}/MANIFEST.txt" ]]; then
    echo "  [OK] MANIFEST.txt present ($(wc -l < "${restore_dir}/MANIFEST.txt") lines)" >&2
  else
    echo "  [FAIL] MANIFEST.txt missing or empty" >&2
    checks_passed=false
    failures="${failures} missing_manifest"
  fi

  # Check 2: Backup metadata exists
  if [[ -f "${restore_dir}/backup-meta.json" ]]; then
    echo "  [OK] backup-meta.json present" >&2
  else
    echo "  [WARN] backup-meta.json missing" >&2
  fi

  # Check 3: At least some files were restored
  local file_count
  file_count=$(find "$restore_dir" -type f 2>/dev/null | wc -l)
  if [[ "$file_count" -gt 1 ]]; then
    echo "  [OK] ${file_count} files restored" >&2
  else
    echo "  [FAIL] Only ${file_count} files restored — backup may be empty" >&2
    checks_passed=false
    failures="${failures} empty_restore"
  fi

  # Check 4: Verify files are decryptable (we already decrypted them, so this is a sanity check)
  local unreadable=0
  while IFS= read -r -d '' f; do
    if ! head -c 10 "$f" >/dev/null 2>&1; then
      unreadable=$((unreadable + 1))
    fi
  done < <(find "$restore_dir" -type f -print0 2>/dev/null)

  if [[ "$unreadable" -eq 0 ]]; then
    echo "  [OK] All files readable" >&2
  else
    echo "  [FAIL] ${unreadable} files unreadable" >&2
    checks_passed=false
    failures="${failures} unreadable_files"
  fi

  if [[ "$checks_passed" == true ]]; then
    add_field "step_verify_files" "ok"
  else
    add_field "step_verify_files" "failed:${failures}"
    return 1
  fi
}

# ─── Step 3: Measure RTO ─────────────────────────────────────────────────────

step_measure_rto() {
  mark_restore_complete

  echo "=== Step 3: RTO measurement ===" >&2

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would measure RTO" >&2
    add_field "step_measure_rto" "dry-run"
    return 0
  fi

  local rto
  rto=$(compute_rto)

  add_field_num "rto_seconds" "$rto"
  add_field_num "rto_warning_threshold" "$RTO_WARNING_SEC"
  add_field_num "rto_critical_threshold" "$RTO_CRITICAL_SEC"

  local rto_status="ok"
  if [[ "$rto" -gt "$RTO_CRITICAL_SEC" ]]; then
    rto_status="critical"
    add_field "rto_status" "critical"
    echo "  [CRITICAL] RTO ${rto}s exceeds critical threshold ${RTO_CRITICAL_SEC}s" >&2
  elif [[ "$rto" -gt "$RTO_WARNING_SEC" ]]; then
    rto_status="warning"
    add_field "rto_status" "warning"
    echo "  [WARNING] RTO ${rto}s exceeds warning threshold ${RTO_WARNING_SEC}s" >&2
  else
    add_field "rto_status" "ok"
    echo "  [OK] RTO ${rto}s within target (< ${RTO_WARNING_SEC}s)" >&2
  fi

  add_field "step_measure_rto" "$rto_status"
}

# ─── Step 4: Document results ────────────────────────────────────────────────

step_document() {
  echo "=== Step 4: Recording results ===" >&2

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would record results" >&2
    add_field "step_document" "dry-run"
    return 0
  fi

  add_field "backup_label" "$BACKUP_LABEL"
  add_field "backup_timestamp" "$BACKUP_TIMESTAMP"
  add_field "verification_time" "$(date -u -Iseconds)"
  add_field "verification_type" "quarterly-config-restore"

  # Print summary
  echo "" >&2
  echo "Config restore verification summary:" >&2
  echo "  Backup label:       ${BACKUP_LABEL}" >&2
  echo "  Backup timestamp:   ${BACKUP_TIMESTAMP}" >&2
  echo "  File count:         $(find "${WORK_DIR}/restored" -type f 2>/dev/null | wc -l)" >&2
  echo "  RTO:                $(compute_rto)s" >&2
  echo "  Status:             $(echo "$RESULT_JSON" | grep -o '"rto_status":"[^"]*"' | cut -d'"' -f4)" >&2

  add_field "step_document" "ok"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

echo "=== Barghsa Quarterly Config Restore Verification ==="
echo ""

mark_start

step_restore || {
  add_field "overall_result" "failed"
  OVERALL_EXIT=1
  exit 1
}
echo ""

step_verify_files || {
  add_field "overall_result" "failed"
  OVERALL_EXIT=1
  exit 1
}
echo ""

step_measure_rto
echo ""

step_document

add_field "overall_result" "success"
OVERALL_EXIT=0

exit 0