#!/usr/bin/env bash
set -euo pipefail
exec 3<>/dev/tcp/127.0.0.1/3310
printf 'PING\n' >&3
read -r reply <&3
test "$reply" = PONG
