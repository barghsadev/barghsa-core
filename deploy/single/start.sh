#!/usr/bin/env bash
set -euo pipefail

if ! mountpoint -q /data && [[ ${ALLOW_EPHEMERAL_DATA:-} != 1 ]]; then
  echo 'Refusing to start: mount a persistent Liara disk at /data' >&2
  exit 1
fi
for name in POSTGRES_PASSWORD S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY AUTH_DELIVERY_ENCRYPTION_KEY; do
  if [[ -z ${!name:-} ]]; then echo "Missing $name" >&2; exit 1; fi
done

export POSTGRES_USER=barghsa POSTGRES_DB=barghsa
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
DATABASE_URL="$(python3 -c 'import os,urllib.parse; print("postgresql://barghsa:"+urllib.parse.quote(os.environ["POSTGRES_PASSWORD"],safe="")+"@127.0.0.1:5432/barghsa")')"
export DATABASE_URL
export PGDIRECT_URL="$DATABASE_URL" REDIS_URL=redis://127.0.0.1:6379/0
export PORT=8080
mkdir -p /data/postgres /data/redis /data/weed /data/clamav
chown -R postgres:postgres /data/postgres
chown -R clamav:clamav /data/clamav
chmod 700 /data/postgres

children=()
# shellcheck disable=SC2329 # Invoked by the signal and exit traps.
stop() {
  trap - TERM INT
  kill -TERM "${children[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap 'stop; exit 0' TERM INT
trap 'stop' EXIT

docker-entrypoint.sh postgres -c listen_addresses=127.0.0.1 & children+=("$!")
redis-server --bind 127.0.0.1 --port 6379 --dir /data/redis --appendonly yes --save '60 1000' & children+=("$!")
weed mini -dir=/data/weed -bucket="$S3_BUCKET" -webdav=false -admin.ui=false & children+=("$!")

for attempt in {1..120}; do
  if pg_isready -h 127.0.0.1 -U barghsa -d barghsa >/dev/null 2>&1 \
    && redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -qx PONG \
    && curl -s --max-time 2 http://127.0.0.1:8333/ >/dev/null; then break; fi
  if (( attempt == 120 )); then echo 'Backing services did not start' >&2; exit 1; fi
  sleep 2
done

sed -i '/^DatabaseDirectory /d' /etc/clamav/freshclam.conf
printf '\nDatabaseDirectory /data/clamav\n' >> /etc/clamav/freshclam.conf
sed -i '/^DatabaseDirectory /d; /^TCPSocket /d; /^TCPAddr /d; /^StreamMaxLength /d; /^AlertExceedsMax /d' /etc/clamav/clamd.conf
printf '\nDatabaseDirectory /data/clamav\nTCPSocket 3310\nTCPAddr 127.0.0.1\nStreamMaxLength 50M\nAlertExceedsMax yes\n' >> /etc/clamav/clamd.conf
if ! find /data/clamav -maxdepth 1 \( -name '*.cvd' -o -name '*.cld' \) | grep -q .; then
  freshclam --stdout || { echo 'ClamAV signature download failed' >&2; exit 1; }
fi
clamd --foreground & children+=("$!")
freshclam --daemon --foreground & children+=("$!")

echo 'Running database migrations'
(cd /app/api && node node_modules/@barghsa/db/dist/migrate.js)

(cd /app/api && PORT=4000 node dist/src/main.js) & children+=("$!")
(cd /app/worker && WORKER_PORT=9090 node dist/main.js) & children+=("$!")
(cd /app/web && PORT=3000 HOST=127.0.0.1 node server.js) & children+=("$!")
nginx -g 'daemon off;' & children+=("$!")

wait -n "${children[@]}"
echo 'A required process stopped; restarting container' >&2
exit 1
