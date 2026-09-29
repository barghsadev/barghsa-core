#!/usr/bin/env bash
set -euo pipefail

app="${1:?Usage: deploy/liara-rescue/deploy.sh LIARA_APP_NAME}"
dir="$(cd "$(dirname "$0")" && pwd)"
liara deploy --app "$app" --platform docker --port 8080 --path "$dir"
