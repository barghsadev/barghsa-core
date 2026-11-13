#!/usr/bin/env bash
set -euo pipefail
umask 077

receipt=${1:-}
bundle_dir=${2:-}
bundle_manifest_sha=${3:-}
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
if [[ -n $(git status --porcelain) ]]; then
  echo 'Commit deployment changes before building a release' >&2
  exit 1
fi
commit="$(git rev-parse HEAD)"
version=$(python3 deploy/staging/release-queue.py check-release --commit "$commit")
python3 kanban/scripts/board.py ready --release "$version"
# Validate notes and Telegram channel before spending time building images.
python3 deploy/staging/notify-release.py --check --commit "$commit"
if [[ -n "$bundle_dir" ]]; then
  bundle=$(python3 deploy/staging/release-queue.py verify-image-bundle "$bundle_dir" "$commit" "$bundle_manifest_sha")
  read -r app_id web_id archive_sha <<< "$bundle"
fi

host="${BARGHSA_VPS_HOST:-89.42.199.13}"
port="${BARGHSA_VPS_SSH_PORT:-30222}"
tag="vps-$commit"
remote="root@$host"
ssh_args=(-p "$port" -o BatchMode=yes)
scp_args=(-P "$port" -o BatchMode=yes)

images=()
postgres_id=
clamav_id=
postgres_volume=barghsa-staging_pgdata
stateful=$(ssh "${ssh_args[@]}" "$remote" \
  "if test -e /etc/barghsa/staging/active-images.env; then grep -E '^BARGHSA_(POSTGRES_IMAGE|POSTGRES_VOLUME|CLAMAV_IMAGE)=' /etc/barghsa/staging/active-images.env; fi")
if [[ -n "$stateful" ]]; then
  postgres_image=$(printf '%s\n' "$stateful" | sed -n 's/^BARGHSA_POSTGRES_IMAGE=//p')
  clamav_image=$(printf '%s\n' "$stateful" | sed -n 's/^BARGHSA_CLAMAV_IMAGE=//p')
  if [[ "$stateful" == *BARGHSA_POSTGRES_VOLUME=* ]]; then
    postgres_volume=$(printf '%s\n' "$stateful" | sed -n 's/^BARGHSA_POSTGRES_VOLUME=//p')
  fi
  [[ "$postgres_image" =~ ^barghsa-postgres:vps-[a-z0-9._-]+$ &&
     "$clamav_image" =~ ^barghsa-clamav:vps-[a-z0-9._-]+$ ]] || {
    echo 'Invalid active stateful image tags on VPS' >&2
    exit 1
  }
  [[ "$postgres_volume" =~ ^barghsa-staging_pgdata([._-][a-z0-9][a-z0-9._-]*)?$ ]] || {
    echo 'Invalid active PostgreSQL volume name on VPS' >&2
    exit 1
  }
  echo 'Keeping the existing PostgreSQL and ClamAV images and volumes' >&2
else
  if [[ -n "$bundle_dir" ]]; then
    echo 'The application image bundle needs an initialized staging database and scanner' >&2
    exit 1
  fi
  postgres_image="barghsa-postgres:$tag"
  clamav_image="barghsa-clamav:$tag"
  bash deploy/staging/build-postgres-image.sh "$postgres_image"
  docker build --platform linux/amd64 -f deploy/clamav/Dockerfile -t "$clamav_image" .
  images+=("$postgres_image" "$clamav_image")
  postgres_id=$(docker image inspect --format '{{.Id}}' "$postgres_image")
  clamav_id=$(docker image inspect --format '{{.Id}}' "$clamav_image")
  [[ "$postgres_id" =~ ^sha256:[0-9a-f]{64}$ && "$clamav_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo 'Invalid initial PostgreSQL or ClamAV image ID' >&2
    exit 1
  }
fi

if [[ -z "$bundle_dir" ]]; then
  docker build --platform linux/amd64 --build-arg "BARGHSA_RELEASE_SHA=$commit" -f Dockerfile.base --target production -t "barghsa-app:$tag" .
  docker build --platform linux/amd64 --build-arg "BARGHSA_RELEASE_SHA=$commit" -f Dockerfile.web --target production -t "barghsa-web:$tag" .
  app_id=$(docker image inspect --format '{{.Id}}' "barghsa-app:$tag")
  web_id=$(docker image inspect --format '{{.Id}}' "barghsa-web:$tag")
fi
[[ "$app_id" =~ ^sha256:[0-9a-f]{64}$ && "$web_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo 'Invalid release image IDs' >&2
  exit 1
}
# A rebuild of the same source must never replace a tag used for rollback.
app_image="barghsa-app:$tag-${app_id#sha256:}"
web_image="barghsa-web:$tag-${web_id#sha256:}"

if [[ -n "$bundle_dir" ]]; then
  scan_dir=$bundle_dir
  # The destination checks the complete archive before Docker reads any tag.
  load_archive=$(cat <<'BASH'
set -euo pipefail
umask 077
archive=$(mktemp)
trap 'rm -f -- "$archive"' EXIT
cat > "$archive"
printf '%s  %s\n' "$1" "$archive" | sha256sum --check --status
docker load --input "$archive"
BASH
)
  printf -v load_command 'bash -c %q -- %q' "$load_archive" "$archive_sha"
  echo 'Transferring verified staging image bundle over SSH' >&2
  # shellcheck disable=SC2029 # The fixed script and checked hash are quoted for the remote shell.
  ssh "${ssh_args[@]}" "$remote" "$load_command" < "$bundle_dir/images.tar.gz"
else
  docker image tag "$app_id" "$app_image"
  docker image tag "$web_id" "$web_image"
  images+=("$app_image" "$web_image")

  # Scan the exact new images and retain each attempt, including failures.
  scan_root="${HOME}/.local/state/barghsa-staging-queue/image-scans"
  if [[ -n "$receipt" ]]; then
    scan_root=$(dirname -- "$receipt")
  fi
  mkdir -p -- "$scan_root"
  scan_dir=$(mktemp -d "$scan_root/image-scan.XXXXXXXX")
  echo "Scanning release images; evidence: $scan_dir" >&2
  bash scripts/check-runtime-images.sh "$scan_dir" "${images[@]}"
  license_mode=initialized
  if [[ -n "$postgres_id" ]]; then
    license_mode=bootstrap
  fi
  python3 scripts/check-release-licenses.py "$scan_dir" "$commit" \
    --staging-local "$license_mode" --report "$scan_dir/release-licenses.json"

  echo 'Transferring release images over SSH' >&2
  docker save "${images[@]}" \
    | gzip -1 | ssh "${ssh_args[@]}" "$remote" 'gzip -d | docker load'
fi

ssh "${ssh_args[@]}" "$remote" 'mkdir -p /opt/barghsa/staging /etc/barghsa/staging /etc/nginx/snippets /etc/letsencrypt/renewal-hooks/deploy'
scp "${scp_args[@]}" deploy/staging/compose.yml deploy/staging/postgres.conf deploy/staging/freshclam.conf deploy/staging/check-s3.py "$remote:/opt/barghsa/staging/"
scp "${scp_args[@]}" deploy/staging/release.sh "$remote:/usr/local/sbin/barghsa-staging-release"
scp "${scp_args[@]}" deploy/staging/init-runtime.sh "$remote:/usr/local/sbin/barghsa-staging-init-runtime"
scp "${scp_args[@]}" deploy/staging/nginx-api-proxy.conf "$remote:/etc/nginx/snippets/barghsa-api-proxy.conf"
scp "${scp_args[@]}" deploy/staging/nginx-s3-proxy.conf "$remote:/etc/nginx/snippets/barghsa-s3-proxy.conf"
scp "${scp_args[@]}" deploy/staging/nginx.conf "$remote:/etc/nginx/conf.d/barghsa-staging.conf"
scp "${scp_args[@]}" deploy/staging/certbot-reload-nginx.sh "$remote:/etc/letsencrypt/renewal-hooks/deploy/barghsa-reload-nginx"
ssh "${ssh_args[@]}" "$remote" 'chmod 750 /usr/local/sbin/barghsa-staging-release /usr/local/sbin/barghsa-staging-init-runtime /etc/letsencrypt/renewal-hooks/deploy/barghsa-reload-nginx'
ssh "${ssh_args[@]}" "$remote" 'nginx -t && systemctl reload nginx'
ssh "${ssh_args[@]}" "$remote" '/usr/local/sbin/barghsa-staging-init-runtime'

release_tmp="$(mktemp -d)"
trap 'rm -rf "$release_tmp"' EXIT
manifest="$release_tmp/candidate.env"
cat > "$manifest" <<EOF
BARGHSA_STAGING_RELEASE_COMMIT=$commit
BARGHSA_APP_IMAGE=$app_image
BARGHSA_APP_IMAGE_ID=$app_id
BARGHSA_WEB_IMAGE=$web_image
BARGHSA_WEB_IMAGE_ID=$web_id
BARGHSA_POSTGRES_IMAGE=$postgres_image
BARGHSA_POSTGRES_VOLUME=$postgres_volume
BARGHSA_CLAMAV_IMAGE=$clamav_image
EOF
if [[ -n "$postgres_id" ]]; then
  printf 'BARGHSA_POSTGRES_IMAGE_ID=%s\nBARGHSA_CLAMAV_IMAGE_ID=%s\n' "$postgres_id" "$clamav_id" >> "$manifest"
fi
candidate="/etc/barghsa/staging/candidate-$tag-${app_id#sha256:}-${web_id#sha256:}.env"
scp "${scp_args[@]}" "$manifest" "$remote:$candidate"
# shellcheck disable=SC2029 # The fixed candidate path is intentionally expanded locally.
ssh "${ssh_args[@]}" "$remote" "chmod 600 $candidate"
# shellcheck disable=SC2029 # Pass the same locally constructed path to the VPS.
ssh "${ssh_args[@]}" "$remote" "/usr/local/sbin/barghsa-staging-release $candidate" | tee "$release_tmp/release.log"
verify=(verify-images --commit "$commit" --app-id "$app_id" --web-id "$web_id" --release-log "$release_tmp/release.log" --scan-dir "$scan_dir")
if [[ -n "$postgres_id" ]]; then
  verify+=(--includes-stateful)
fi
if [[ -n "$receipt" ]]; then
  verify+=(--receipt "$receipt")
fi
python3 deploy/staging/release-queue.py "${verify[@]}"
python3 deploy/staging/notify-release.py --commit "$commit"
