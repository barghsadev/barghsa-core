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

for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL PGDIRECT_URL REDIS_URL S3_ENDPOINT S3_PRIVATE_ENDPOINT S3_PUBLIC_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY APP_PUBLIC_URL API_PUBLIC_URL SESSION_SECRET CSRF_SECRET PROVIDER_CONFIG_ENCRYPTION_KEY AUTH_DELIVERY_ENCRYPTION_KEY AI_MODEL_ENCRYPTION_KEY STORAGE_CONFIG_ENCRYPTION_KEY PAYMENT_GATEWAY_MERCHANT_ID PAYMENT_GATEWAY_WEBHOOK_SECRET; do
  [[ -n "${!key:-}" ]] || { printf 'Missing runtime value: %s\n' "$key" >&2; exit 1; }
done
[[ "$APP_PUBLIC_URL" == https://stg.barghsa.com && "$API_PUBLIC_URL" == "$APP_PUBLIC_URL" ]] || {
  echo 'Public app URLs must match https://stg.barghsa.com' >&2; exit 1;
}
[[ "$S3_PUBLIC_ENDPOINT" == "$APP_PUBLIC_URL" && "$S3_ENDPOINT" == http://objectstore:8333 && "$S3_PRIVATE_ENDPOINT" == "$S3_ENDPOINT" && "$S3_FORCE_PATH_STYLE" == true ]] || {
  echo 'S3 settings must match the single-domain path-style gateway' >&2; exit 1;
}
for key in BARGHSA_APP_IMAGE BARGHSA_WEB_IMAGE BARGHSA_POSTGRES_IMAGE BARGHSA_CLAMAV_IMAGE; do
  [[ "${!key:-}" =~ ^barghsa-(app|web|postgres|clamav):vps-[a-z0-9._-]+$ ]] || {
    printf 'Invalid local image tag: %s\n' "$key" >&2; exit 1;
  }
  docker image inspect "${!key}" >/dev/null
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

rollback() {
  local status=$?
  trap - ERR
  echo 'Release failed; restoring previous app images' >&2
  if [[ -r "$active" ]]; then
    local previous=(docker compose --env-file "$runtime" --env-file "$active" -f "$compose")
    "${previous[@]}" up -d --no-deps api web worker || true
  else
    "${dc[@]}" stop worker web api || true
  fi
  exit "$status"
}
trap rollback ERR

"${dc[@]}" pull redis objectstore
"${dc[@]}" up -d --no-recreate --wait --wait-timeout 900 postgres redis objectstore clamav

# Host NGINX enters the API through the Docker bridge gateway.
export BARGHSA_PROXY_IPS
BARGHSA_PROXY_IPS=$(docker network inspect barghsa-staging-private --format '{{(index .IPAM.Config 0).Gateway}}')
[[ -n "$BARGHSA_PROXY_IPS" ]] || { echo 'Docker bridge gateway missing' >&2; false; }

if [[ "${BARGHSA_DISPOSABLE:-false}" != true ]]; then
  /usr/local/sbin/barghsa-staging-backup
else
  echo 'Disposable staging: no offsite backup is configured' >&2
fi

"${dc[@]}" stop worker || true
"${dc[@]}" run --rm --no-deps api node run-packaged-migrations.cjs
"${dc[@]}" up -d --no-deps --wait --wait-timeout 240 api
"${dc[@]}" up -d --no-deps --wait --wait-timeout 240 web
"${dc[@]}" up -d --no-deps --wait --wait-timeout 240 worker

curl --fail --silent --show-error --max-time 20 "$APP_PUBLIC_URL/api/health/ready" >/dev/null
curl --fail --silent --show-error --max-time 20 "$APP_PUBLIC_URL/" >/dev/null
[[ $(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "$S3_PUBLIC_ENDPOINT/$S3_BUCKET/") == 403 ]] || {
  echo 'Public S3 gateway did not return AccessDenied' >&2; false;
}

install -m 0600 "$candidate" "$active"
trap - ERR
printf 'Staging release healthy: %s\n' "$BARGHSA_APP_IMAGE"
