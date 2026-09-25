#!/usr/bin/env bash
set -euo pipefail
curl -fsS --max-time 5 -H 'Host: app.barghsa.com' http://127.0.0.1:8080/api/health/ready >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:9090/health/ready >/dev/null
curl -fsS --max-time 5 -H 'Host: app.barghsa.com' http://127.0.0.1:8080/ >/dev/null
