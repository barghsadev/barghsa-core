#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ $(id -u) -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
runtime=/etc/barghsa/staging/runtime.env
active=/etc/barghsa/staging/active-images.env
candidate="${1:?Usage: release.sh /etc/barghsa/staging/candidate-images.env}"
compose=/opt/barghsa/staging/compose.yml
exec 9>/run/lock/barghsa-staging-release.lock
flock -n 9 || { echo 'Another release is running' >&2; exit 1; }
[[ -r "$runtime" && -r "$candidate" ]] || { echo 'Runtime or image manifest missing' >&2; exit 1; }

set -a
# Root-owned configuration only.
# shellcheck source=/dev/null
source "$runtime"
# shellcheck source=/dev/null
source "$candidate"
set +a

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
  case "$key" in
    BARGHSA_APP_IMAGE|BARGHSA_WEB_IMAGE)
      expected_key=${key}_ID
      [[ "${!expected_key:-}" =~ ^sha256:[0-9a-f]{64}$ && "$loaded_id" == "${!expected_key}" ]] || {
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
if [[ -r "$active" ]]; then
  for key in BARGHSA_POSTGRES_IMAGE BARGHSA_CLAMAV_IMAGE; do
    previous=$(sed -n "s/^${key}=//p" "$active")
    [[ "$previous" == "${!key}" ]] || {
      printf '%s changed; upgrade stateful images separately after a backup\n' "$key" >&2
      exit 1
    }
  done
fi

dc=(docker compose --env-file "$runtime" --env-file "$candidate" -f "$compose")
"${dc[@]}" config --quiet

verify_running_image() {
  local service=$1 expected_id=$2 container running_id
  container=$("${dc[@]}" ps -q "$service") || return
  running_id=$(docker container inspect --format '{{.Image}}' "$container") || return
  if [[ "$running_id" != "$expected_id" ]]; then
    printf 'Running image ID differs from the candidate manifest: %s\n' "$service" >&2
    return 1
  fi
}

rollback() {
  local status=$?
  trap - ERR
  if [[ -r "$active" ]]; then
    local previous=(docker compose --env-file "$runtime" --env-file "$active" -f "$compose")
    # Compose gives exported shell variables priority over the previous manifest.
    if ! (
      unset BARGHSA_APP_IMAGE BARGHSA_WEB_IMAGE BARGHSA_POSTGRES_IMAGE BARGHSA_CLAMAV_IMAGE
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
        if ! "${previous[@]}" stop worker web api ai-inference; then
          echo 'Stopping the staging application after the failed schema check also failed' >&2
        fi
        exit 1
      fi
      echo 'Release failed; restoring previous app images' >&2
      "${previous[@]}" up -d --no-deps --wait --wait-timeout 240 api web worker ai-inference
    ); then
      echo 'Restoring the previous staging app images failed' >&2
    fi
  else
    "${dc[@]}" stop worker web api ai-inference || true
  fi
  exit "$status"
}
trap rollback ERR

# These images are pinned by digest; a cached exact image needs no registry round trip.
"${dc[@]}" pull --policy missing redis objectstore
"${dc[@]}" up -d --no-recreate --wait --wait-timeout 900 postgres redis objectstore clamav
verify_running_image postgres "$postgres_id"
verify_running_image clamav "$clamav_id"

# Host NGINX enters the API through the Docker bridge gateway.
export BARGHSA_PROXY_IPS
BARGHSA_PROXY_IPS=$(docker network inspect barghsa-staging-private --format '{{(index .IPAM.Config 0).Gateway}}')
[[ -n "$BARGHSA_PROXY_IPS" ]] || { echo 'Docker bridge gateway missing' >&2; false; }

[[ "${BARGHSA_DISPOSABLE:-false}" == true ]] || {
  echo 'Offsite backup is not configured; refusing a non-disposable release' >&2
  false
}
echo 'Disposable staging: no offsite backup is configured' >&2

"${dc[@]}" stop worker ai-inference || true
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

kind = sys.argv[1]
try:
    body = json.load(sys.stdin)
    status = body.get("status")
    valid = status == "ok" if kind == "live" else (
        status in ("ok", "degraded") and body["checks"]["postgresql"]["status"] == "ok"
    )
except (ValueError, AttributeError, KeyError, TypeError):
    valid = False
if not valid:
    sys.exit(f"Invalid staging {kind} health response")
' "$health"
done
curl --fail --silent --show-error --max-time 20 "$APP_PUBLIC_URL/" >/dev/null
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
