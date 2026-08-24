#!/usr/bin/env bash
# Barghsa Quarterly Restore Verification Script
#
# Verifies that the latest backup can be successfully restored and the
# restored database is functional. Designed to be run on-demand or from
# a quarterly scheduled job.
#
# Process:
#   1. Restores the latest full backup + WAL replay to an isolated directory
#   2. Starts a temporary PostgreSQL instance on the restored data
#   3. Runs system-level verification checks
#   4. Runs application-level verification SQL (if VERIFY_SQL_FILE is set)
#   5. Measures and records RTO and RPO
#   6. Alerts (via exit code + structured JSON) if thresholds are exceeded
#
# Usage:
#   ./verify-restore.sh                               # Run full verification
#   ./verify-restore.sh --dry-run                     # Print what would be done
#   ./verify-restore.sh --work-dir /tmp/barghsa-verify # Custom working directory
#   ./verify-restore.sh --help                        # Show this message
#
# Required environment variables:
#   BACKUP_S3_ENDPOINT — S3-compatible endpoint (e.g., http://minio:9000)
#   BACKUP_S3_BUCKET   — S3 bucket for backups
#   BACKUP_S3_ACCESS_KEY
#   BACKUP_S3_SECRET_KEY
#
# Optional:
#   VERIFY_SQL_FILE    — Path to a .sql file with application verification queries.
#                        Each query should be a SELECT returning rows; output is
#                        printed and checked for errors.
#   RTO_WARNING_SEC    — Warning threshold for RTO in seconds (default: 3600 = 60 min)
#   RTO_CRITICAL_SEC   — Critical threshold for RTO (default: 7200 = 120 min)
#   RPO_WARNING_SEC    — Warning threshold for RPO in seconds (default: 300 = 5 min)
#   RPO_CRITICAL_SEC   — Critical threshold for RPO (default: 900 = 15 min)
#   PG_BIN             — Path to PostgreSQL binaries (default: auto-detect)
#   WORK_DIR           — Working directory (default: /tmp/barghsa-restore-verify)
#   RESTORE_SCRIPT     — Path to restore-pg.sh (default: same directory as this script)

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
S3_BUCKET="${BACKUP_S3_BUCKET:-barghsa-backups}"
S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-}"
S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-}"

VERIFY_SQL_FILE="${VERIFY_SQL_FILE:-}"
RTO_WARNING_SEC="${RTO_WARNING_SEC:-3600}"    # 60 min
RTO_CRITICAL_SEC="${RTO_CRITICAL_SEC:-7200}"  # 120 min
RPO_WARNING_SEC="${RPO_WARNING_SEC:-300}"      # 5 min
RPO_CRITICAL_SEC="${RPO_CRITICAL_SEC:-900}"    # 15 min
PG_BIN="${PG_BIN:-}"
WORK_DIR="${WORK_DIR:-/tmp/barghsa-restore-verify}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTORE_SCRIPT="${RESTORE_SCRIPT:-${SCRIPT_DIR}/restore-pg.sh}"

DRY_RUN=false

# PostgreSQL ports — use a high ephemeral port to avoid collisions
PG_PORT=15432
PG_HOST="/tmp"

START_TS=""
RESTORE_END_TS=""
VERIFY_END_TS=""

BACKUP_LABEL=""
BACKUP_TIMESTAMP=""

# ─── Result accumulator ───────────────────────────────────────────────────────
# We build a JSON result object as we go
RESULT_JSON='{}'
add_result_field() {
  local key="$1"
  local value="$2"
  local updated
  updated=$(echo "$RESULT_JSON" | jq --arg k "$key" --arg v "$value" '. + {($k): $v}' 2>/dev/null) || {
    echo "ERROR: jq failed to add field $key" >&2
    return 1
  }
  RESULT_JSON="$updated"
}

add_result_field_num() {
  local key="$1"
  local value="$2"
  local updated
  updated=$(echo "$RESULT_JSON" | jq --arg k "$key" --argjson v "$value" '. + {($k): $v}' 2>/dev/null) || {
    echo "ERROR: jq failed to add numeric field $key" >&2
    return 1
  }
  RESULT_JSON="$updated"
}

# ─── Help ─────────────────────────────────────────────────────────────────────

show_help() {
  sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# //; s/^#$//'
  exit 0
}

# ─── Parse arguments ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --work-dir) WORK_DIR="$2"; shift 2 ;;
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
  echo "ERROR: restore-pg.sh not found or not executable: ${RESTORE_SCRIPT}" >&2
  exit 1
fi

if ! command -v pg_ctl &>/dev/null && [[ -z "$PG_BIN" ]]; then
  echo "WARNING: pg_ctl not found in PATH — will attempt auto-detect" >&2
fi

if ! command -v psql &>/dev/null && [[ -z "$PG_BIN" ]]; then
  echo "ERROR: psql is not installed" >&2
  exit 1
fi

if [[ -n "$VERIFY_SQL_FILE" && ! -f "$VERIFY_SQL_FILE" ]]; then
  echo "ERROR: Verification SQL file not found: ${VERIFY_SQL_FILE}" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required for JSON output" >&2
  exit 1
fi

# ─── Helper: find PostgreSQL binaries ──────────────────────────────────────────

find_pg_bin() {
  if [[ -n "$PG_BIN" ]]; then
    echo "$PG_BIN"
    return 0
  fi

  # Try pg_config first — verify the returned directory exists
  if command -v pg_config &>/dev/null; then
    local bindir
    bindir=$(pg_config --bindir 2>/dev/null || true)
    if [[ -n "$bindir" && -d "$bindir" ]]; then
      echo "$bindir"
      return 0
    fi
  fi

  # Common paths
  for dir in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin /opt/homebrew/opt/postgresql@*/bin; do
    if [[ -d "$dir" ]]; then
      echo "$dir"
      return 0
    fi
  done

  echo ""
  return 1
}

PG_BIN_DIR=$(find_pg_bin)
if [[ -z "$PG_BIN_DIR" ]]; then
  echo "ERROR: Could not locate PostgreSQL binaries" >&2
  exit 1
fi

PG_CTL="${PG_BIN_DIR}/pg_ctl"
PSQL="${PG_BIN_DIR}/psql"
INITDB="${PG_BIN_DIR}/initdb"

# ─── RTO tracking ─────────────────────────────────────────────────────────────

mark_start() {
  START_TS=$(date -u +%s)
  echo "[$(date -u +%H:%M:%S)] Verification started" >&2
}

mark_restore_complete() {
  RESTORE_END_TS=$(date -u +%s)
}

mark_verify_complete() {
  VERIFY_END_TS=$(date -u +%s)
}

compute_rto() {
  local rto=$((RESTORE_END_TS - START_TS))
  echo "$rto"
}

compute_rpo() {
  if [[ -z "$BACKUP_TIMESTAMP" ]]; then
    echo "-1"
    return
  fi
  local now
  now=$(date -u +%s)
  local backup_epoch

  # Portable ISO-8601 to epoch conversion: try GNU date (-d), then BSD date (-j -f)
  if date -u -d "$BACKUP_TIMESTAMP" +%s &>/dev/null 2>&1; then
    backup_epoch=$(date -u -d "$BACKUP_TIMESTAMP" +%s 2>/dev/null || echo "0")
  elif date -j -f "%Y-%m-%dT%H:%M:%S" "${BACKUP_TIMESTAMP%%Z*}" +%s &>/dev/null 2>&1; then
    backup_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${BACKUP_TIMESTAMP%%Z*}" +%s 2>/dev/null || echo "0")
  else
    backup_epoch="0"
  fi

  if [[ "$backup_epoch" -eq 0 ]]; then
    echo "-1"
    return
  fi
  echo $((now - backup_epoch))
}

# ─── Cleanup ──────────────────────────────────────────────────────────────────

cleanup() {
  local _exit_code=${OVERALL_EXIT:-$?}
  echo "" >&2
  echo "[$(date -u +%H:%M:%S)] Cleaning up..." >&2

  # Stop PostgreSQL if running
  if [[ -f "${WORK_DIR}/data/postmaster.pid" ]]; then
    echo "  Stopping PostgreSQL..." >&2
    if [[ "$DRY_RUN" != true ]]; then
      timeout 10 "${PG_CTL}" -D "${WORK_DIR}/data" stop -m fast 2>/dev/null || true
    fi
  fi

  if [[ "$DRY_RUN" != true ]]; then
    # Remove only the data directory (downloads already cleaned by restore-pg.sh)
    rm -rf "${WORK_DIR}/data" "${WORK_DIR}/pgdata" 2>/dev/null || true
  fi

  # Print final result
  echo "" >&2
  echo "=== Result ===" >&2
  echo "$RESULT_JSON" | jq '.' 2>/dev/null || echo "$RESULT_JSON"

  exit "$_exit_code"
}
trap cleanup EXIT

# ─── Step 1: Restore the latest backup ────────────────────────────────────────

step_restore() {
  echo "=== Step 1: Restoring latest backup ===" >&2

  mkdir -p "$WORK_DIR"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would run: ${RESTORE_SCRIPT} --target-dir ${WORK_DIR} --latest" >&2
    BACKUP_LABEL="latest"
    BACKUP_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    return 0
  fi

  # Run restore-pg.sh to an isolated directory
  # The restore script handles download, extraction, WAL replay, and verification
  # shellcheck disable=SC2015
  RESTORE_OUTPUT=$(RESTORE_DIR="$WORK_DIR" "${RESTORE_SCRIPT}" --target-dir "$WORK_DIR" --latest 2>&1) || {
    echo "ERROR: restore-pg.sh failed" >&2
    # Sanitize: redact S3 credentials from error output before display
    echo "$RESTORE_OUTPUT" | sed "s/${BACKUP_S3_ACCESS_KEY:-__NONE__}/***REDACTED***/g; s/${BACKUP_S3_SECRET_KEY:-__NONE__}/***REDACTED***/g" >&2
    add_result_field "step_restore" "failed"
    return 1
  }

  # Capture the backup label from the restore script's output
  BACKUP_LABEL=$(echo "$RESTORE_OUTPUT" | grep -oP 'Backup:\s+\K.+' 2>/dev/null || echo "unknown")

  # Extract backup timestamp from the backup label (ISO-8601 format from backup-pg.sh)
  BACKUP_TIMESTAMP="$BACKUP_LABEL"

  # Check that restored data exists
  if [[ ! -f "${WORK_DIR}/data/PG_VERSION" ]]; then
    echo "ERROR: Restored data directory missing PG_VERSION — restore failed" >&2
    add_result_field "step_restore" "failed"
    return 1
  fi

  add_result_field "step_restore" "ok"
  echo "[$(date -u +%H:%M:%S)] Restore completed successfully" >&2
}

# ─── Step 2: Start temporary PostgreSQL instance ──────────────────────────────

step_start_postgres() {
  echo "=== Step 2: Starting temporary PostgreSQL instance ===" >&2

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would start PostgreSQL on port ${PG_PORT} with data from ${WORK_DIR}/data" >&2
    return 0
  fi

  # Find an available port
  local test_port="$PG_PORT"
  # Portable port-busy check: uses bash /dev/tcp (works everywhere bash does, no external deps)
  while (: </dev/tcp/127.0.0.1/$test_port) 2>/dev/null; do
    test_port=$((test_port + 1))
  done
  PG_PORT="$test_port"

  echo "  Port: ${PG_PORT}" >&2

  local conf_file="${WORK_DIR}/data/postgresql.conf"

  # Generate a fresh postgresql.conf for temporary instance
  # Move any existing config aside to avoid conflict with recovery settings
  local restored_conf="${WORK_DIR}/data/postgresql.conf"
  if [[ -f "$restored_conf" ]]; then
    mv "$restored_conf" "${restored_conf}.restored-bak"
  fi

  {
    echo "# Temporary verification instance — auto-generated by verify-restore.sh"
    echo "# Original restored config saved as postgresql.conf.restored-bak"
    echo "port = ${PG_PORT}"
    echo "listen_addresses = ''"                    # No network access
    echo "unix_socket_directories = '${PG_HOST}'"  # Unix socket only
    echo "max_connections = 5"                      # Minimal for verification
    echo "log_min_messages = 'WARNING'"
    echo "log_error_verbosity = 'terse'"
  } > "$conf_file"

  # Start PostgreSQL
  echo "  Starting PostgreSQL..." >&2
  if ! "${PG_CTL}" -D "${WORK_DIR}/data" -l "${WORK_DIR}/pg.log" start; then
    echo "ERROR: PostgreSQL failed to start" >&2
    if [[ -f "${WORK_DIR}/pg.log" ]]; then
      echo "  Log output:" >&2
      tail -20 "${WORK_DIR}/pg.log" >&2
    fi
    add_result_field "step_start_postgres" "failed"
    return 1
  fi

  # Wait for PostgreSQL to be ready
  local retries=15
  local ready=false
  for i in $(seq 1 $retries); do
    if "${PSQL}" -h "${PG_HOST}" -p "${PG_PORT}" -d postgres -c "SELECT 1 AS ready" -t -A 2>/dev/null | grep -q "1"; then
      ready=true
      break
    fi
    sleep 1
  done

  if [[ "$ready" != true ]]; then
    echo "ERROR: PostgreSQL did not become ready within ${retries}s" >&2
    if [[ -f "${WORK_DIR}/pg.log" ]]; then
      echo "  Log output:" >&2
      tail -20 "${WORK_DIR}/pg.log" >&2
    fi
    add_result_field "step_start_postgres" "failed"
    return 1
  fi

  add_result_field "step_start_postgres" "ok"
  echo "[$(date -u +%H:%M:%S)] PostgreSQL is ready on port ${PG_PORT}" >&2
}

# ─── Step 3: System-level verification ────────────────────────────────────────

step_system_verify() {
  echo "=== Step 3: System-level verification ===" >&2

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would run system health checks" >&2
    add_result_field "step_system_verify" "dry-run"
    return 0
  fi

  local checks_passed=true
  local failures=""

  # Check 1: PostgreSQL is running and accepting connections
  local pg_version
  pg_version=$("${PSQL}" -h "${PG_HOST}" -p "${PG_PORT}" -d postgres \
    -c "SELECT version()" -t -A 2>/dev/null || echo "")
  if [[ -z "$pg_version" ]]; then
    checks_passed=false
    failures="${failures} pg_version_check"
  else
    echo "  [OK] PostgreSQL version: ${pg_version}" >&2
  fi

  # Check 2: WAL replay is complete (not in recovery mode)
  local recovery_status
  recovery_status=$("${PSQL}" -h "${PG_HOST}" -p "${PG_PORT}" -d postgres \
    -c "SELECT pg_is_in_recovery()" -t -A 2>/dev/null || echo "unknown")
  if [[ "$recovery_status" == "t" ]]; then
    echo "  [INFO] Database is still in recovery mode (WAL replay ongoing)" >&2
  elif [[ "$recovery_status" == "f" ]]; then
    echo "  [OK] WAL replay complete — database is out of recovery" >&2
  fi

  # Check 3: Check for corrupt indexes
  local index_errors
  index_errors=$("${PSQL}" -h "${PG_HOST}" -p "${PG_PORT}" -d postgres \
    -c "SELECT count(*) AS corrupted_indexes FROM pg_stat_all_indexes WHERE NOT indisvalid" \
    -t -A 2>/dev/null || echo "0")
  if [[ "$index_errors" != "0" ]]; then
    echo "  [WARN] ${index_errors} invalid indexes found" >&2
  fi

  # Check 4: Connection to 'postgres' database works
  local db_count
  db_count=$("${PSQL}" -h "${PG_HOST}" -p "${PG_PORT}" -d postgres \
    -c "SELECT count(*) AS databases FROM pg_database WHERE datistemplate = false" \
    -t -A 2>/dev/null || echo "0")
  echo "  [OK] ${db_count} databases accessible" >&2

  # Check 5: pg_stat_statements (if extension is installed)
  local has_pg_stat_statements
  has_pg_stat_statements=$("${PSQL}" -h "${PG_HOST}" -p "${PG_PORT}" -d postgres \
    -c "SELECT count(*) FROM pg_extension WHERE extname = 'pg_stat_statements'" \
    -t -A 2>/dev/null || echo "0")
  if [[ "$has_pg_stat_statements" -gt 0 ]]; then
    echo "  [OK] pg_stat_statements extension present" >&2
  fi

  if [[ "$checks_passed" == true ]]; then
    add_result_field "step_system_verify" "ok"
  else
    add_result_field "step_system_verify" "failed:${failures}"
    return 1
  fi
}

# ─── Step 4: Application verification SQL ─────────────────────────────────────

step_app_verify() {
  if [[ -z "$VERIFY_SQL_FILE" ]]; then
    echo "=== Step 4: Application verification — SKIPPED (VERIFY_SQL_FILE not set) ===" >&2
    add_result_field "step_app_verify" "skipped"
    return 0
  fi

  echo "=== Step 4: Application verification ===" >&2

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would run SQL from: ${VERIFY_SQL_FILE}" >&2
    add_result_field "step_app_verify" "dry-run"
    return 0
  fi

  echo "  Running verification SQL from: ${VERIFY_SQL_FILE}" >&2

  local sql_output
  sql_output=$("${PSQL}" -h "${PG_HOST}" -p "${PG_PORT}" -d postgres \
    -f "$VERIFY_SQL_FILE" 2>&1) || {
    echo "  ERROR: Verification SQL failed:" >&2
    echo "$sql_output" >&2
    add_result_field "step_app_verify" "failed"
    return 1
  }

  echo "  Verification SQL output:" >&2
  echo "$sql_output" | sed 's/^/    /' >&2

  add_result_field "step_app_verify" "ok"
}

# ─── Step 5: Measure and record RTO/RPO ───────────────────────────────────────

step_measure_performance() {
  mark_verify_complete

  echo "=== Step 5: Performance measurement ===" >&2

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would measure RTO and RPO" >&2
    return 0
  fi

  local rto
  rto=$(compute_rto)
  local rpo
  rpo=$(compute_rpo)

  # Format durations
  local rto_min=$((rto / 60))
  local rto_sec=$((rto % 60))
  local rpo_min=$((rpo / 60))
  local rpo_sec=$((rpo % 60))

  local rto_status="ok"
  local rpo_status="ok"
  local overall_status="ok"

  # Check RTO thresholds
  if [[ "$rto" -gt "$RTO_CRITICAL_SEC" ]]; then
    rto_status="critical"
    overall_status="critical"
  elif [[ "$rto" -gt "$RTO_WARNING_SEC" ]]; then
    rto_status="warning"
    if [[ "$overall_status" != "critical" ]]; then
      overall_status="warning"
    fi
  fi

  # Check RPO thresholds
  if [[ "$rpo" -ge 0 ]]; then
    if [[ "$rpo" -gt "$RPO_CRITICAL_SEC" ]]; then
      rpo_status="critical"
      overall_status="critical"
    elif [[ "$rpo" -gt "$RPO_WARNING_SEC" ]]; then
      rpo_status="warning"
      if [[ "$overall_status" != "critical" ]]; then
        overall_status="warning"
      fi
    fi
  else
    rpo_status="critical"
    overall_status="critical"
  fi

  echo "  RTO:  ${rto_min}m ${rto_sec}s (${rto}s total)  — status: ${rto_status}" >&2
  if [[ "$rpo" -ge 0 ]]; then
    echo "  RPO:  ${rpo_min}m ${rpo_sec}s (${rpo}s total)  — status: ${rpo_status}" >&2
  fi
  echo "  Overall status: ${overall_status}" >&2

  # Record results
  add_result_field_num "rto_seconds" "$rto"
  add_result_field "rto_status" "$rto_status"
  add_result_field_num "rpo_seconds" "$rpo"
  add_result_field "rpo_status" "$rpo_status"
  add_result_field "overall_status" "$overall_status"
  add_result_field "backup_label" "$BACKUP_LABEL"
  add_result_field "timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ "$overall_status" == "critical" ]]; then
    echo "ERROR: Critical thresholds exceeded — RTO or RPO outside acceptable range" >&2
    return 1
  elif [[ "$overall_status" == "warning" ]]; then
    echo "WARNING: Thresholds approaching limit — RTO or RPO above warning level" >&2
    return 0  # Non-fatal for exit code, but recorded in JSON
  fi
}

# ─── Summary ───────────────────────────────────────────────────────────────────

print_summary() {
  local status_line="$1"

  echo "" >&2
  echo "=== Verification Summary ===" >&2
  echo "  Result: ${status_line}" >&2
  echo "  Backup: ${BACKUP_LABEL:-unknown}" >&2
  echo "  Work dir: ${WORK_DIR}" >&2
  echo "  Port: ${PG_PORT}" >&2
  echo "" >&2
}

# ─── Main ─────────────────────────────────────────────────────────────────────

echo "=== Barghsa Restore Verification ==="
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo ""

OVERALL_EXIT=0

mark_start

# Step 1: Restore backup
step_restore
mark_restore_complete

# Step 2: Start PostgreSQL
step_start_postgres

# Step 3: System verification
step_system_verify

# Step 4: Application verification (optional)
step_app_verify

# Step 5: Measure performance
if step_measure_performance; then
  print_summary "PASS"
  add_result_field "exit_code" "0"
else
  print_summary "FAIL (thresholds exceeded)"
  add_result_field "exit_code" "1"
  OVERALL_EXIT=1
fi

# Print final JSON to stdout (not stderr) for programmatic consumption
echo ""
echo "$RESULT_JSON" | jq '.' 2>/dev/null || echo "$RESULT_JSON"

exit "$OVERALL_EXIT"