#!/bin/sh
set -eu
reply=$(printf 'PING\n' | nc -w 3 127.0.0.1 3310)
test "$reply" = PONG
