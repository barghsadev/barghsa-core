#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ $(id -u) -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
runtime=/etc/barghsa/staging/runtime.env
active=/etc/barghsa/staging/active-images.env
candidate="${1:?Usage: release.sh /etc/barghsa/staging/candidate-images.env}"
compose=/opt/barghsa/staging/compose.yml
compose_files=(-f "$compose")
exec 9>/run/lock/barghsa-staging-release.lock
flock -n 9 || { echo 'Another release is running' >&2; exit 1; }
[[ -r "$runtime" && -r "$candidate" ]] || { echo 'Runtime or image manifest missing' >&2; exit 1; }

set -a
# Root-owned configuration only.
# shellcheck source=/dev/null
source "$runtime"
BARGHSA_POSTGRES_VOLUME=barghsa-staging_pgdata
# shellcheck source=/dev/null
source "$candidate"
set +a

backup_env=/etc/barghsa/staging/backup.env
backup_key=/etc/barghsa/staging/backup-key
if [[ "${BARGHSA_DISPOSABLE:-false}" != true ]]; then
  [[ -s "$backup_env" && -r "$backup_env" && -s "$backup_key" && -r "$backup_key" ]] || {
    echo 'Non-disposable staging requires protected off-server backup configuration and key' >&2
    exit 1
  }
fi
if [[ "${BARGHSA_STAGING_WAL_ARCHIVE:-false}" == true ]]; then
  [[ "${BARGHSA_DISPOSABLE:-false}" != true && -s /etc/barghsa/staging/wal-archive.env ]] || {
    echo 'Staging WAL archiving requires non-disposable storage and protected archiver configuration' >&2
    exit 1
  }
  compose_files+=(-f /opt/barghsa/staging/compose.wal-archive.yml)
fi

for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL PGDIRECT_URL REDIS_URL S3_ENDPOINT S3_PRIVATE_ENDPOINT S3_PUBLIC_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY APP_PUBLIC_URL API_PUBLIC_URL SESSION_SECRET CSRF_SECRET PROVIDER_CONFIG_ENCRYPTION_KEY AUTH_DELIVERY_ENCRYPTION_KEY AI_MODEL_ENCRYPTION_KEY AI_INFERENCE_SHARED_SECRET STORAGE_CONFIG_ENCRYPTION_KEY PAYMENT_GATEWAY_MERCHANT_ID PAYMENT_GATEWAY_WEBHOOK_SECRET; do
  [[ -n "${!key:-}" ]] || { printf 'Missing runtime value: %s\n' "$key" >&2; exit 1; }
done
[[ ${#AI_INFERENCE_SHARED_SECRET} -ge 32 ]] || {
  echo 'AI inference secret must be at least 32 characters' >&2; exit 1;
}
[[ "$APP_PUBLIC_URL" == https://stg.barghsa.com && "$API_PUBLIC_URL" == "$APP_PUBLIC_URL" ]] || {
  echo 'Public app URLs must match https://stg.barghsa.com' >&2; exit 1;
}
[[ "$S3_PUBLIC_ENDPOINT" == "$APP_PUBLIC_URL" && "$S3_ENDPOINT" == http://objectstore:8333 && "$S3_PRIVATE_ENDPOINT" == "$S3_ENDPOINT" && "$S3_FORCE_PATH_STYLE" == true ]] || {
  echo 'S3 settings must match the single-domain path-style gateway' >&2; exit 1;
}
commit=${BARGHSA_STAGING_RELEASE_COMMIT:-}
[[ -z "$commit" || "$commit" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Invalid release commit in the candidate manifest' >&2; exit 1;
}
for key in BARGHSA_APP_IMAGE BARGHSA_WEB_IMAGE BARGHSA_POSTGRES_IMAGE BARGHSA_CLAMAV_IMAGE; do
  [[ "${!key:-}" =~ ^barghsa-(app|web|postgres|clamav):vps-[a-z0-9._-]+$ ]] || {
    printf 'Invalid local image tag: %s\n' "$key" >&2; exit 1;
  }
  loaded_id=$(docker image inspect --format '{{.Id}}' "${!key}")
  [[ "$loaded_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    printf 'Invalid loaded image ID: %s\n' "$key" >&2
    exit 1
  }
  expected_key=${key}_ID
  if [[ -n "${!expected_key:-}" && "$loaded_id" != "${!expected_key}" ]]; then
    printf 'Loaded image ID differs from the candidate manifest: %s\n' "$key" >&2
    exit 1
  fi
  case "$key" in
    BARGHSA_APP_IMAGE|BARGHSA_WEB_IMAGE)
      [[ -n "${!expected_key:-}" ]] || {
        printf 'Loaded image ID differs from the candidate manifest: %s\n' "$key" >&2
        exit 1
      }
      if [[ -n "$commit" ]]; then
        revision=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$loaded_id")
        [[ "$revision" == "$commit" ]] || {
          printf 'Loaded image revision differs from the candidate commit: %s\n' "$key" >&2
          exit 1
        }
      fi
      ;;
    BARGHSA_POSTGRES_IMAGE) postgres_id=$loaded_id ;;
    BARGHSA_CLAMAV_IMAGE) clamav_id=$loaded_id ;;
  esac
done
[[ "$BARGHSA_POSTGRES_VOLUME" =~ ^barghsa-staging_pgdata([._-][a-z0-9][a-z0-9._-]*)?$ ]] || {
  echo 'Invalid candidate PostgreSQL volume name' >&2
  exit 1
}
if [[ -e "$active" ]]; then
  [[ -r "$active" ]] || { echo 'Active staging manifest is unreadable' >&2; exit 1; }
  for key in BARGHSA_POSTGRES_IMAGE BARGHSA_CLAMAV_IMAGE; do
    previous=$(sed -n "s/^${key}=//p" "$active")
    [[ "$previous" == "${!key}" ]] || {
      printf '%s changed; upgrade stateful images separately after a backup\n' "$key" >&2
      exit 1
    }
  done
  previous_volume=barghsa-staging_pgdata
  if grep -q '^BARGHSA_POSTGRES_VOLUME=' "$active"; then
    previous_volume=$(sed -n 's/^BARGHSA_POSTGRES_VOLUME=//p' "$active")
  fi
  [[ "$BARGHSA_POSTGRES_VOLUME" == "$previous_volume" ]] || {
    echo 'PostgreSQL volume changed; cut over separately after a backup' >&2
    exit 1
  }
  docker volume inspect "$BARGHSA_POSTGRES_VOLUME" >/dev/null || {
    echo 'The active PostgreSQL volume is missing' >&2
    exit 1
  }
elif [[ "$BARGHSA_POSTGRES_VOLUME" != barghsa-staging_pgdata ]]; then
  echo 'A new staging installation requires the default PostgreSQL volume' >&2
  exit 1
fi

dc=(docker compose --env-file "$runtime" --env-file "$candidate" "${compose_files[@]}")
"${dc[@]}" config --quiet

verify_postgres_mount() {
  local mount
  mount=$(docker container inspect --format \
    '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}:{{.Name}}:{{.RW}}{{end}}{{end}}' "$1") || return
  if [[ "$mount" != "volume:$BARGHSA_POSTGRES_VOLUME:true" ]]; then
    echo 'PostgreSQL data mount differs from the active volume' >&2
    return 1
  fi
}

verify_running_image() {
  local service=$1 expected_id=$2 container=${3:-} running_id
  if [[ -z "$container" ]]; then
    container=$("${dc[@]}" ps -q "$service") || return
  fi
  running_id=$(docker container inspect --format '{{.Image}}' "$container") || return
  if [[ "$running_id" != "$expected_id" ]]; then
    printf 'Running image ID differs from the candidate manifest: %s\n' "$service" >&2
    return 1
  fi
  if [[ "$service" == postgres ]]; then
    verify_postgres_mount "$container" || return
  fi
}

rollback() {
  local status=$?
  trap - ERR
  if [[ -r "$active" ]]; then
    local previous=(docker compose --env-file "$runtime" --env-file "$active" "${compose_files[@]}")
    local previous_app_id previous_web_id loaded_app_id loaded_web_id service expected_id container
    if ! (
      if ! verify_running_image postgres "$postgres_id"; then
        echo 'PostgreSQL image or volume could not be verified for rollback' >&2
        stop_rollback_services "${previous[@]}"
        exit 1
      fi
      if ! previous_app_id=$(sed -n 's/^BARGHSA_APP_IMAGE_ID=//p' "$active") ||
        ! previous_web_id=$(sed -n 's/^BARGHSA_WEB_IMAGE_ID=//p' "$active") ||
        [[ ! "$previous_app_id" =~ ^sha256:[0-9a-f]{64}$ || ! "$previous_web_id" =~ ^sha256:[0-9a-f]{64}$ ]] ||
        ! loaded_app_id=$(docker image inspect --format '{{.Id}}' "$previous_app_id") ||
        ! loaded_web_id=$(docker image inspect --format '{{.Id}}' "$previous_web_id") ||
        [[ "$loaded_app_id" != "$previous_app_id" || "$loaded_web_id" != "$previous_web_id" ]]; then
        echo 'Previous staging app or web image ID is missing or unavailable for rollback' >&2
        stop_rollback_services "${previous[@]}"
        exit 1
      fi
      # Compose gives exported shell variables priority over the previous manifest.
      previous=(env "BARGHSA_APP_IMAGE=$previous_app_id" "BARGHSA_WEB_IMAGE=$previous_web_id" "${previous[@]}")
      unset BARGHSA_POSTGRES_IMAGE BARGHSA_CLAMAV_IMAGE
      if ! "${previous[@]}" run --rm --no-deps api node -e '
const { createDbPool, dbHealth, closeDbPools } = require("@barghsa/db");
(async () => {
  createDbPool();
  try {
    if (!(await dbHealth({ verifySchema: true })).ok) process.exitCode = 1;
  } finally {
    await closeDbPools();
  }
})().catch(() => { process.exitCode = 1; });
'; then
        echo 'Previous app could not verify the current database schema. Recover the matching app and database pair, or roll forward.' >&2
        stop_rollback_services "${previous[@]}"
        exit 1
      fi
      echo 'Release failed; restoring previous app images' >&2
      if ! "${previous[@]}" up -d --no-deps --wait --wait-timeout 240 api web worker ai-inference; then
        stop_rollback_services "${previous[@]}"
        exit 1
      fi
      for service in api worker ai-inference web; do
        expected_id=$previous_app_id
        if [[ "$service" == web ]]; then
          expected_id=$previous_web_id
        fi
        if ! container=$("${previous[@]}" ps -q "$service") || [[ -z "$container" ]] ||
          ! verify_running_image "$service" "$expected_id" "$container"; then
          stop_rollback_services "${previous[@]}"
          exit 1
        fi
      done
    ); then
      echo 'Restoring the previous staging app images failed' >&2
    fi
  else
    "${dc[@]}" stop worker web api ai-inference || true
  fi
  exit "$status"
}

stop_rollback_services() {
  if ! "$@" stop worker web api ai-inference; then
    echo 'Stopping the staging application during failed rollback also failed' >&2
  fi
}

# Check an existing container, including a stopped one, before Compose can start it.
postgres_container=$("${dc[@]}" ps --all -q postgres)
if [[ -n "$postgres_container" ]]; then
  verify_running_image postgres "$postgres_id" "$postgres_container"
fi
trap rollback ERR

# These images are pinned by digest; a cached exact image needs no registry round trip.
"${dc[@]}" pull --policy missing redis objectstore
"${dc[@]}" up -d --no-recreate --wait --wait-timeout 900 postgres redis objectstore clamav
verify_running_image postgres "$postgres_id"
verify_running_image clamav "$clamav_id"
if [[ "${BARGHSA_STAGING_WAL_ARCHIVE:-false}" == true ]]; then
  archive_settings=$("${dc[@]}" exec -T --user postgres postgres psql -XAt -v ON_ERROR_STOP=1 \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SHOW archive_mode' -c 'SHOW archive_command')
  [[ "$archive_settings" == $'on\n/opt/backup/archive-wal.sh %f %p' ]] || {
    echo 'Staging PostgreSQL is not running with the encrypted WAL archiver' >&2
    false
  }
fi

# Host NGINX enters the API through the Docker bridge gateway.
export BARGHSA_PROXY_IPS
BARGHSA_PROXY_IPS=$(docker network inspect barghsa-staging-private --format '{{(index .IPAM.Config 0).Gateway}}')
[[ -n "$BARGHSA_PROXY_IPS" ]] || { echo 'Docker bridge gateway missing' >&2; false; }

# Quiesce the previous API and worker before taking the migration checkpoint.
"${dc[@]}" stop worker api ai-inference
if [[ "${BARGHSA_DISPOSABLE:-false}" == true ]]; then
  echo 'Disposable staging: no offsite backup is configured' >&2
else
  backup_label="release-${commit:0:12}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  database_system_id=$("${dc[@]}" exec -T --user postgres postgres psql -XAt -v ON_ERROR_STOP=1 \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT system_identifier FROM pg_control_system()')
  backup_manifest=$(docker run --rm --user postgres --network barghsa-staging-private \
    --env-file "$backup_env" --env BACKUP_ALLOW_HTTP=false \
    --env BACKUP_GPG_PASSPHRASE_FILE=/run/secrets/backup-key \
    --mount "type=bind,src=$backup_key,dst=/run/secrets/backup-key,readonly" \
    --entrypoint /opt/backup/backup-pg.sh "$postgres_id" --label "$backup_label")
  printf '%s\n' "$backup_manifest" | python3 -c '
import json, re, sys

label, system_id = sys.argv[1:]
manifest = json.load(sys.stdin)
if (not re.fullmatch(r"[0-9]+", system_id) or manifest["version"] != 1
        or manifest["label"] != label or manifest["system_id"] != system_id
        or manifest.get("upload_verified") is not True
        or not re.fullmatch(r"[a-f0-9]{64}", manifest["sha256"])):
    sys.exit("Verified encrypted backup receipt is missing or does not match the running staging database")
print("BARGHSA_STAGING_MIGRATION_BACKUP_V1", json.dumps(manifest, separators=(",", ":")))
' "$backup_label" "$database_system_id"
fi
"${dc[@]}" run --rm --no-deps api node run-packaged-migrations.cjs
"${dc[@]}" up -d --no-deps --wait --wait-timeout 240 ai-inference
"${dc[@]}" up -d --no-deps --wait --wait-timeout 240 api
"${dc[@]}" up -d --no-deps --wait --wait-timeout 240 web
"${dc[@]}" up -d --no-deps --wait --wait-timeout 240 worker

for service in api worker ai-inference web; do
  expected_id=$BARGHSA_APP_IMAGE_ID
  if [[ "$service" == web ]]; then
    expected_id=$BARGHSA_WEB_IMAGE_ID
  fi
  verify_running_image "$service" "$expected_id"
done

for health in live ready; do
  curl --fail --silent --show-error --max-time 20 "$APP_PUBLIC_URL/api/health/$health" |
    python3 -c '
import json, sys

kind, commit = sys.argv[1:]
try:
    body = json.load(sys.stdin)
    status = body.get("status")
    valid = status == "ok" if kind == "live" else (
        status in ("ok", "degraded") and body["checks"]["postgresql"]["status"] == "ok"
        and (not commit or body.get("commit") == commit)
    )
except (ValueError, AttributeError, KeyError, TypeError):
    valid = False
if not valid:
    sys.exit(f"Invalid staging {kind} health response")
' "$health" "$commit"
done
curl --fail --silent --show-error --max-time 20 "$APP_PUBLIC_URL/" >/dev/null
if [[ -n "$commit" ]]; then
  curl --fail --silent --show-error --max-time 20 -H 'Cache-Control: no-cache' \
    "$APP_PUBLIC_URL/release.json?commit=$commit" |
    python3 -c '
import json, sys

try:
    valid = json.load(sys.stdin).get("commit") == sys.argv[1]
except (ValueError, AttributeError):
    valid = False
if not valid:
    sys.exit("Staging web release does not match the candidate commit")
' "$commit"
fi
[[ $(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "$S3_PUBLIC_ENDPOINT/$S3_BUCKET/") == 403 ]] || {
  echo 'Public S3 gateway did not return AccessDenied' >&2; false;
}
docker run --rm --env-file "$runtime" --network barghsa-staging-private \
  -v /opt/barghsa/staging/check-s3.py:/tmp/barghsa-check-s3.py:ro \
  "$BARGHSA_POSTGRES_IMAGE" python /tmp/barghsa-check-s3.py

verify_running_image postgres "$postgres_id"
verify_running_image clamav "$clamav_id"
install -m 0600 "$candidate" "$active"
trap - ERR
printf 'Staging release healthy: %s\n' "$BARGHSA_APP_IMAGE"
printf 'Staging app and web image IDs: %s %s\n' "$BARGHSA_APP_IMAGE_ID" "$BARGHSA_WEB_IMAGE_ID"
printf 'Staging PostgreSQL and ClamAV image IDs: %s %s\n' "$postgres_id" "$clamav_id"
if [[ -n "$commit" ]]; then
  printf 'BARGHSA_STAGING_RUNTIME_IMAGES_V1 %s %s %s %s %s\n' \
    "$commit" "$BARGHSA_APP_IMAGE_ID" "$BARGHSA_WEB_IMAGE_ID" "$postgres_id" "$clamav_id"
fi
