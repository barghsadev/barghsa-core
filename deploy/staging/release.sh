#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $(id -u) -ne 0 ]]; then
  echo 'Run as root so Docker and private configuration are accessible' >&2
  exit 1
fi

runtime=/etc/barghsa/staging/runtime.env
active=/etc/barghsa/staging/active-images.env
candidate="${1:?Usage: release.sh /path/to/images.env}"
compose=/opt/barghsa/staging/compose.yml
backup=/usr/local/sbin/barghsa-staging-backup

exec 9>/run/lock/barghsa-staging-release.lock
flock -n 9 || { echo 'Another staging release is running' >&2; exit 1; }
[[ -r "$runtime" && -r "$candidate" ]] || { echo 'Runtime or candidate image file missing' >&2; exit 1; }
[[ "$(realpath "$candidate")" != "$(realpath -m "$active")" ]] || {
  echo 'Candidate manifest must differ from the active manifest' >&2; exit 1;
}

set -a
# Root-owned files only; never source a file received from an untrusted user.
# shellcheck source=/dev/null
source "$runtime"
# shellcheck source=/dev/null
source "$candidate"
set +a

for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL PGDIRECT_URL REDIS_URL S3_ENDPOINT S3_PRIVATE_ENDPOINT S3_PUBLIC_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY APP_PUBLIC_URL API_PUBLIC_URL SESSION_SECRET CSRF_SECRET PROVIDER_CONFIG_ENCRYPTION_KEY AUTH_DELIVERY_ENCRYPTION_KEY AI_MODEL_ENCRYPTION_KEY STORAGE_CONFIG_ENCRYPTION_KEY PAYMENT_GATEWAY_MERCHANT_ID PAYMENT_GATEWAY_WEBHOOK_SECRET; do
  [[ -n "${!key:-}" ]] || { printf 'Missing runtime value: %s\n' "$key" >&2; exit 1; }
done
[[ "$APP_PUBLIC_URL" == https://* && "$API_PUBLIC_URL" == "$APP_PUBLIC_URL" ]] || {
  echo 'APP_PUBLIC_URL and API_PUBLIC_URL must be the same HTTPS origin' >&2; exit 1;
}
[[ "$S3_PUBLIC_ENDPOINT" == https://* ]] || { echo 'S3_PUBLIC_ENDPOINT must use HTTPS' >&2; exit 1; }
[[ "$S3_ENDPOINT" == http://objectstore:8333 && "$S3_PRIVATE_ENDPOINT" == "$S3_ENDPOINT" && "${S3_FORCE_PATH_STYLE:-}" == true ]] || {
  echo 'Local S3 endpoints and path-style setting must match SeaweedFS' >&2; exit 1;
}
for key in BARGHSA_APP_IMAGE BARGHSA_WEB_IMAGE BARGHSA_POSTGRES_IMAGE BARGHSA_CLAMAV_IMAGE BARGHSA_REDIS_IMAGE BARGHSA_OBJECTSTORE_IMAGE; do
  [[ "${!key:-}" =~ ^[^[:space:]]+@sha256:[0-9a-f]{64}$ ]] || {
    printf 'Image must be pinned to a SHA-256 digest: %s\n' "$key" >&2; exit 1;
  }
done
if [[ -r "$active" ]]; then
  for key in BARGHSA_POSTGRES_IMAGE BARGHSA_CLAMAV_IMAGE BARGHSA_REDIS_IMAGE BARGHSA_OBJECTSTORE_IMAGE; do
    previous=$(sed -n "s/^${key}=//p" "$active")
    [[ "$previous" == "${!key}" ]] || {
      printf '%s changed; upgrade stateful infrastructure in a maintenance window\n' "$key" >&2
      exit 1
    }
  done
fi

dc=(docker compose --env-file "$runtime" --env-file "$candidate" -f "$compose")
"${dc[@]}" config --quiet

rollback() {
  local status=$?
  trap - ERR
  echo 'Release failed; restoring previous application images' >&2
  if [[ -r "$active" ]]; then
    local previous=(docker compose --env-file "$runtime" --env-file "$active" -f "$compose")
    "${previous[@]}" up -d --no-deps api web worker || true
  else
    "${dc[@]}" stop worker web api || true
  fi
  exit "$status"
}
trap rollback ERR

"${dc[@]}" pull postgres redis objectstore clamav api web worker
"${dc[@]}" up -d --no-recreate --wait --wait-timeout 900 postgres redis objectstore clamav
bucket_ready=false
for attempt in {1..30}; do
  if AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
      AWS_DEFAULT_REGION="$S3_REGION" aws --endpoint-url http://127.0.0.1:8333 \
      s3api head-bucket --bucket "$S3_BUCKET" >/dev/null 2>&1; then
    bucket_ready=true
    break
  fi
  sleep 2
done
[[ "$bucket_ready" == true ]] || { echo 'S3 bucket not ready' >&2; false; }

# NGINX reaches loopback-published API through this bridge gateway.
# Trust exactly that immediate peer, never a wildcard or subnet.
export BARGHSA_PROXY_IPS
BARGHSA_PROXY_IPS=$(docker network inspect barghsa-staging-private \
  --format '{{(index .IPAM.Config 0).Gateway}}')
[[ -n "$BARGHSA_PROXY_IPS" ]] || { echo 'Docker bridge gateway not found' >&2; false; }

if [[ "${BARGHSA_DISPOSABLE:-false}" != true ]]; then
  "$backup" "$candidate"
else
  echo 'Disposable staging: pre-migration backup skipped' >&2
fi

"${dc[@]}" stop worker || true
"${dc[@]}" run --rm --no-deps api node run-packaged-migrations.cjs
"${dc[@]}" up -d --no-deps --wait --wait-timeout 180 api
"${dc[@]}" up -d --no-deps --wait --wait-timeout 180 web
"${dc[@]}" up -d --no-deps --wait --wait-timeout 180 worker

curl --fail --silent --show-error --max-time 20 "$APP_PUBLIC_URL/api/health/ready" >/dev/null
curl --fail --silent --show-error --max-time 20 "$APP_PUBLIC_URL/" >/dev/null
[[ $(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "$S3_PUBLIC_ENDPOINT/") == 403 ]] || {
  echo 'Public S3 gateway did not return expected authenticated response' >&2; false;
}

install -m 0600 "$candidate" "$active"
trap - ERR
printf 'Staging release healthy: %s\n' "$BARGHSA_APP_IMAGE"
