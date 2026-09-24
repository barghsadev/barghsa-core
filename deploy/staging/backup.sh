#!/usr/bin/env bash
set -euo pipefail
umask 077

dir=/etc/barghsa/staging
backup_env="$dir/backup.env"
active_images="${1:-$dir/active-images.env}"
runtime="$dir/runtime.env"
compose=/opt/barghsa/staging/compose.yml
backup_dir=/var/backups/barghsa-staging

exec 8>/run/lock/barghsa-staging-backup.lock
flock 8

for file in "$backup_env" "$active_images" "$runtime"; do
  if [[ ! -r "$file" ]]; then
    printf 'Missing required file: %s\n' "$file" >&2
    exit 1
  fi
done

set -a
# These files are root-owned configuration, not untrusted input.
# shellcheck source=/dev/null
source "$runtime"
# shellcheck source=/dev/null
source "$backup_env"
set +a

for key in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY BARGHSA_BACKUP_ENDPOINT BARGHSA_BACKUP_BUCKET BARGHSA_BACKUP_GPG_KEY_FILE S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET; do
  if [[ -z "${!key:-}" ]]; then
    printf 'Missing backup setting: %s\n' "$key" >&2
    exit 1
  fi
done
[[ "$BARGHSA_BACKUP_ENDPOINT" == https://* ]] || { echo 'Backup endpoint must use HTTPS' >&2; exit 1; }
[[ -r "$BARGHSA_BACKUP_GPG_KEY_FILE" ]] || { echo 'Backup encryption key missing' >&2; exit 1; }

mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
output="$backup_dir/postgres-$stamp.dump.gpg"
partial="$output.partial"
trap 'rm -f "$partial"' EXIT

docker compose --env-file "$runtime" --env-file "$active_images" -f "$compose" \
  exec -T -u postgres postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  | gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BARGHSA_BACKUP_GPG_KEY_FILE" \
      --symmetric --cipher-algo AES256 --output "$partial"
mv "$partial" "$output"
sha256sum "$output" > "$output.sha256"

aws --endpoint-url "$BARGHSA_BACKUP_ENDPOINT" s3 cp --only-show-errors \
  "$output" "s3://$BARGHSA_BACKUP_BUCKET/postgres/$(basename "$output")"
aws --endpoint-url "$BARGHSA_BACKUP_ENDPOINT" s3 cp --only-show-errors \
  "$output.sha256" "s3://$BARGHSA_BACKUP_BUCKET/postgres/$(basename "$output.sha256")"

# Copy uploaded objects directly between S3 endpoints without a local spool.
# The destination bucket must have encryption, versioning, and retention.
export RCLONE_CONFIG_SOURCE_TYPE=s3
export RCLONE_CONFIG_SOURCE_PROVIDER=Other
export RCLONE_CONFIG_SOURCE_ENV_AUTH=false
export RCLONE_CONFIG_SOURCE_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_SOURCE_ENDPOINT=http://127.0.0.1:8333
export RCLONE_CONFIG_SOURCE_REGION="${S3_REGION:-us-east-1}"
export RCLONE_CONFIG_DESTINATION_TYPE=s3
export RCLONE_CONFIG_DESTINATION_PROVIDER=Other
export RCLONE_CONFIG_DESTINATION_ENV_AUTH=false
export RCLONE_CONFIG_DESTINATION_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
export RCLONE_CONFIG_DESTINATION_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_DESTINATION_ENDPOINT="$BARGHSA_BACKUP_ENDPOINT"
export RCLONE_CONFIG_DESTINATION_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
rclone copy --retries 3 "source:$S3_BUCKET" "destination:$BARGHSA_BACKUP_BUCKET/objects"
rm -f "$output" "$output.sha256"
printf 'Database and objects uploaded: %s\n' "$(basename "$output")"
