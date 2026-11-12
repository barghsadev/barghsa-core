#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
if [[ -n $(git status --porcelain) ]]; then
  echo 'Commit deployment changes before building a release' >&2
  exit 1
fi
commit="$(git rev-parse HEAD)"
python3 deploy/staging/release-queue.py check-release --commit "$commit"
# Validate notes and Telegram channel before spending time building images.
python3 deploy/staging/notify-release.py --check --commit "$commit"

host="${BARGHSA_VPS_HOST:-89.42.199.13}"
port="${BARGHSA_VPS_SSH_PORT:-30222}"
tag="vps-$commit"
remote="root@$host"
ssh_args=(-p "$port" -o BatchMode=yes)
scp_args=(-P "$port" -o BatchMode=yes)

# This patch updates application images on the initialized staging host.
# Use the installed topology, release runner and stateful image tags.
stateful=$(ssh "${ssh_args[@]}" "$remote" \
  "test -x /usr/local/sbin/barghsa-staging-release && grep -E '^BARGHSA_(POSTGRES|CLAMAV)_IMAGE=' /etc/barghsa/staging/active-images.env")
postgres_image=$(printf '%s\n' "$stateful" | sed -n 's/^BARGHSA_POSTGRES_IMAGE=//p')
clamav_image=$(printf '%s\n' "$stateful" | sed -n 's/^BARGHSA_CLAMAV_IMAGE=//p')
[[ "$postgres_image" =~ ^barghsa-postgres:vps-[a-z0-9._-]+$ &&
   "$clamav_image" =~ ^barghsa-clamav:vps-[a-z0-9._-]+$ ]] || {
  echo 'Invalid active stateful image tags on VPS' >&2
  exit 1
}
echo 'Using the installed staging configuration and stateful images' >&2

docker build --platform linux/amd64 --build-arg "BARGHSA_RELEASE_SHA=$commit" -f Dockerfile.base --target production -t "barghsa-app:$tag" .
docker build --platform linux/amd64 --build-arg "BARGHSA_RELEASE_SHA=$commit" -f Dockerfile.web --target production -t "barghsa-web:$tag" .
app_id=$(docker image inspect --format '{{.Id}}' "barghsa-app:$tag")
web_id=$(docker image inspect --format '{{.Id}}' "barghsa-web:$tag")
[[ "$app_id" =~ ^sha256:[0-9a-f]{64}$ && "$web_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo 'Invalid release image IDs' >&2
  exit 1
}
# A rebuild of the same source must never replace a tag used for rollback.
app_image="barghsa-app:$tag-${app_id#sha256:}"
web_image="barghsa-web:$tag-${web_id#sha256:}"
docker image tag "$app_id" "$app_image"
docker image tag "$web_id" "$web_image"
receipt=${1:-}
scan_root="${HOME}/.local/state/barghsa-staging-queue/image-scans"
if [[ -n "$receipt" ]]; then
  scan_root=$(dirname -- "$receipt")
fi
mkdir -p -- "$scan_root"
scan_dir=$(mktemp -d "$scan_root/image-scan.XXXXXXXX")
bash scripts/check-runtime-images.sh "$scan_dir" "$app_image" "$web_image"

echo 'Transferring release images over SSH' >&2
docker save "$app_image" "$web_image" \
  | gzip -1 | ssh "${ssh_args[@]}" "$remote" 'gzip -d | docker load'
# shellcheck disable=SC2029 # The tags contain only checked image digests and the source SHA.
remote_ids=$(ssh "${ssh_args[@]}" "$remote" \
  "docker image inspect --format '{{.Id}}' '$app_image' '$web_image'")
[[ "$remote_ids" == "$(printf '%s\n%s' "$app_id" "$web_id")" ]] || {
  echo 'Loaded image IDs differ from the release images' >&2
  exit 1
}

manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
cat > "$manifest" <<EOF
BARGHSA_STAGING_RELEASE_COMMIT=$commit
BARGHSA_APP_IMAGE=$app_image
BARGHSA_APP_IMAGE_ID=$app_id
BARGHSA_WEB_IMAGE=$web_image
BARGHSA_WEB_IMAGE_ID=$web_id
BARGHSA_POSTGRES_IMAGE=$postgres_image
BARGHSA_CLAMAV_IMAGE=$clamav_image
EOF
candidate="/etc/barghsa/staging/candidate-$tag-${app_id#sha256:}-${web_id#sha256:}.env"
scp "${scp_args[@]}" "$manifest" "$remote:$candidate"
# shellcheck disable=SC2029 # The fixed candidate path is intentionally expanded locally.
ssh "${ssh_args[@]}" "$remote" "chmod 600 $candidate"
# shellcheck disable=SC2029 # Pass the same locally constructed path to the VPS.
ssh "${ssh_args[@]}" "$remote" "/usr/local/sbin/barghsa-staging-release $candidate"
python3 deploy/staging/notify-release.py --commit "$commit"
