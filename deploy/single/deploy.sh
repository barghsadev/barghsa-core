#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
api_container='' web_container=''
cleanup() {
  [[ -z $api_container ]] || docker rm -f "$api_container" >/dev/null 2>&1 || true
  [[ -z $web_container ]] || docker rm -f "$web_container" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

cd "$root"
docker build --platform linux/amd64 --target build -f Dockerfile.base -t barghsa-single-api-build .
api_container="$(docker create --platform linux/amd64 barghsa-single-api-build)"
mkdir -p "$tmp/api" "$tmp/worker" "$tmp/web"
docker cp "$api_container:/out/api/." "$tmp/api/"
docker cp "$api_container:/out/worker/." "$tmp/worker/"

docker build --platform linux/amd64 --target build -f Dockerfile.web -t barghsa-single-web-build .
web_container="$(docker create --platform linux/amd64 barghsa-single-web-build)"
docker cp "$web_container:/app/apps/web/dist/." "$tmp/web/dist/"
cp apps/web/{package.json,server.js,healthcheck.js,entry-routes.js} "$tmp/web/"

for part in api worker web; do
  COPYFILE_DISABLE=1 tar -czf "$tmp/$part.tar.gz" -C "$tmp/$part" .
done
cp deploy/single/{Dockerfile,nginx.conf,start.sh,healthcheck.sh} "$tmp/"

if [[ ${1:-} == build ]]; then
  docker build --platform linux/amd64 -t barghsa-stg:local "$tmp"
  echo 'Built barghsa-stg:local'
  exit 0
fi
if [[ ${1:-} != deploy ]]; then
  echo 'Usage: deploy/single/deploy.sh build|deploy' >&2
  exit 2
fi
if [[ -z ${LIARA_DISK_NAME:-} ]]; then
  echo 'Set LIARA_DISK_NAME to the existing disk mounted at /data' >&2
  exit 2
fi
liara deploy --app barghsa-stg --platform docker --path "$tmp" --port 8080 --disks "$LIARA_DISK_NAME:/data"
