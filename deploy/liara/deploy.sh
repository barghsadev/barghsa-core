#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
component=${1:-}
case "$component" in
  clamav) app=barghsa-clamav; dockerfile=deploy/clamav/Dockerfile; port=3310 ;;
  api) app=barghsa-api; dockerfile=Dockerfile.base; port=4000 ;;
  worker) app=barghsa-worker; dockerfile=Dockerfile.liara-worker; port=9090 ;;
  web) app=barghsa-web; dockerfile=Dockerfile.web; port=3000 ;;
  edge) app=barghsa-edge; dockerfile=deploy/liara/Dockerfile.edge; port=80 ;;
  *) echo 'Usage: deploy/liara/deploy.sh {clamav|api|worker|web|edge}' >&2; exit 2 ;;
esac

command -v liara >/dev/null || { echo 'Liara CLI is required' >&2; exit 1; }
deploy_path=$repo
if [[ $component == web ]]; then
  command -v pnpm >/dev/null || { echo 'pnpm is required to build web assets' >&2; exit 1; }
  deploy_path=$(mktemp -d)
  build_log=$(mktemp)
  trap 'rm -rf "$deploy_path"; rm -f "$build_log"' EXIT
  if ! (cd "$repo" && pnpm -r --filter @barghsa/web... build >"$build_log" 2>&1); then
    tail -80 "$build_log" >&2
    exit 1
  fi
  cp -R "$repo/apps/web/dist" "$deploy_path/dist"
  cp "$repo/apps/web/server.js" "$repo/apps/web/healthcheck.js" \
    "$repo/apps/web/entry-routes.js" "$deploy_path/"
  cp "$repo/deploy/liara/Dockerfile.web-runtime" "$deploy_path/Dockerfile"
  printf '{"type":"module"}\n' >"$deploy_path/package.json"
  dockerfile=Dockerfile
fi
args=(--app "$app" --platform docker --path "$deploy_path" --dockerfile "$dockerfile" --port "$port" --no-app-logs)
if [[ -n ${LIARA_BUILD_LOCATION:-} ]]; then
  args+=(--build-location "$LIARA_BUILD_LOCATION")
fi
liara deploy "${args[@]}"
