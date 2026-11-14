#!/usr/bin/env bash
set -euo pipefail
exec 9>/run/lock/barghsa-staging-nginx.lock
flock 9
systemctl reload nginx
