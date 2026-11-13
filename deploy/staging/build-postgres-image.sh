#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
image="${1:?Usage: build-postgres-image.sh barghsa-postgres:vps-TAG}"
[[ "$image" =~ ^barghsa-postgres:vps-[a-z0-9._-]+$ ]] || {
  echo 'Invalid staging PostgreSQL image tag' >&2
  exit 1
}
helpers="barghsa-postgres-helpers:${image#*:}"
docker build --platform linux/amd64 -f packages/db/scripts/backup/Dockerfile -t "$helpers" .
docker buildx build --load --platform linux/amd64 --no-cache-filter ubuntu-archive \
  --build-arg "BACKUP_HELPERS_IMAGE=$helpers" \
  -f deploy/staging/Dockerfile.postgres -t "$image" .
