#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
if [[ -n $(git status --porcelain) ]]; then
  echo 'Commit deployment changes before building a release' >&2
  exit 1
fi

host="${BARGHSA_VPS_HOST:-89.42.199.13}"
port="${BARGHSA_VPS_SSH_PORT:-30222}"
tag="vps-$(git rev-parse --short=12 HEAD)"
remote="root@$host"
ssh_args=(-p "$port" -o BatchMode=yes)
scp_args=(-P "$port" -o BatchMode=yes)

images=("barghsa-app:$tag" "barghsa-web:$tag")
if ssh "${ssh_args[@]}" "$remote" 'test -r /etc/barghsa/staging/active-images.env'; then
  stateful=$(ssh "${ssh_args[@]}" "$remote" \
    "grep -E '^BARGHSA_(POSTGRES|CLAMAV)_IMAGE=' /etc/barghsa/staging/active-images.env")
  postgres_image=$(printf '%s\n' "$stateful" | sed -n 's/^BARGHSA_POSTGRES_IMAGE=//p')
  clamav_image=$(printf '%s\n' "$stateful" | sed -n 's/^BARGHSA_CLAMAV_IMAGE=//p')
  [[ "$postgres_image" =~ ^barghsa-postgres:vps-[a-z0-9._-]+$ &&
     "$clamav_image" =~ ^barghsa-clamav:vps-[a-z0-9._-]+$ ]] || {
    echo 'Invalid active stateful image tags on VPS' >&2
    exit 1
  }
  echo 'Keeping the existing PostgreSQL and ClamAV images and volumes' >&2
else
  postgres_image="barghsa-postgres:$tag"
  clamav_image="barghsa-clamav:$tag"
  docker build --platform linux/amd64 -f packages/db/scripts/backup/Dockerfile -t "$postgres_image" .
  docker build --platform linux/amd64 -f deploy/clamav/Dockerfile -t "$clamav_image" .
  images+=("$postgres_image" "$clamav_image")
fi

docker build --platform linux/amd64 -f Dockerfile.base --target production -t "barghsa-app:$tag" .
docker build --platform linux/amd64 -f Dockerfile.web --target production -t "barghsa-web:$tag" .

echo 'Transferring release images over SSH' >&2
docker save "${images[@]}" \
  | gzip -1 | ssh "${ssh_args[@]}" "$remote" 'gzip -d | docker load'

ssh "${ssh_args[@]}" "$remote" 'mkdir -p /opt/barghsa/staging /etc/barghsa/staging /etc/nginx/snippets /etc/letsencrypt/renewal-hooks/deploy'
scp "${scp_args[@]}" deploy/staging/compose.yml deploy/staging/postgres.conf deploy/staging/check-s3.py "$remote:/opt/barghsa/staging/"
scp "${scp_args[@]}" deploy/staging/release.sh "$remote:/usr/local/sbin/barghsa-staging-release"
scp "${scp_args[@]}" deploy/staging/init-runtime.sh "$remote:/usr/local/sbin/barghsa-staging-init-runtime"
scp "${scp_args[@]}" deploy/staging/nginx-api-proxy.conf "$remote:/etc/nginx/snippets/barghsa-api-proxy.conf"
scp "${scp_args[@]}" deploy/staging/nginx-s3-proxy.conf "$remote:/etc/nginx/snippets/barghsa-s3-proxy.conf"
scp "${scp_args[@]}" deploy/staging/nginx.conf "$remote:/etc/nginx/conf.d/barghsa-staging.conf"
scp "${scp_args[@]}" deploy/staging/certbot-reload-nginx.sh "$remote:/etc/letsencrypt/renewal-hooks/deploy/barghsa-reload-nginx"
ssh "${ssh_args[@]}" "$remote" 'chmod 750 /usr/local/sbin/barghsa-staging-release /usr/local/sbin/barghsa-staging-init-runtime /etc/letsencrypt/renewal-hooks/deploy/barghsa-reload-nginx'
ssh "${ssh_args[@]}" "$remote" 'nginx -t && systemctl reload nginx'
ssh "${ssh_args[@]}" "$remote" '/usr/local/sbin/barghsa-staging-init-runtime'

manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
cat > "$manifest" <<EOF
BARGHSA_APP_IMAGE=barghsa-app:$tag
BARGHSA_WEB_IMAGE=barghsa-web:$tag
BARGHSA_POSTGRES_IMAGE=$postgres_image
BARGHSA_CLAMAV_IMAGE=$clamav_image
EOF
candidate="/etc/barghsa/staging/candidate-$tag.env"
scp "${scp_args[@]}" "$manifest" "$remote:$candidate"
# shellcheck disable=SC2029 # The fixed candidate path is intentionally expanded locally.
ssh "${ssh_args[@]}" "$remote" "chmod 600 $candidate"
# shellcheck disable=SC2029 # Pass the same locally constructed path to the VPS.
ssh "${ssh_args[@]}" "$remote" "/usr/local/sbin/barghsa-staging-release $candidate"
