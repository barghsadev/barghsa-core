#!/usr/bin/env bash
set -euo pipefail
umask 077

runtime=/etc/barghsa/staging/runtime.env
if [[ -e "$runtime" ]]; then
  echo "Keeping existing $runtime" >&2
  exit 0
fi
mkdir -p /etc/barghsa/staging

postgres_password=$(openssl rand -hex 24)
s3_access_key=$(openssl rand -hex 12)
s3_secret_key=$(openssl rand -hex 32)
session_secret=$(openssl rand -hex 32)
csrf_secret=$(openssl rand -hex 32)
provider_key=$(openssl rand -hex 32)
auth_key=$(openssl rand -hex 32)
ai_key=$(openssl rand -hex 32)
storage_key=$(openssl rand -hex 32)
webhook_secret=$(openssl rand -hex 32)

cat > "$runtime" <<EOF
POSTGRES_DB=barghsa_staging
POSTGRES_USER=barghsa
POSTGRES_PASSWORD=$postgres_password
DATABASE_URL=postgresql://barghsa:$postgres_password@postgres:5432/barghsa_staging
PGDIRECT_URL=postgresql://barghsa:$postgres_password@postgres:5432/barghsa_staging
REDIS_URL=redis://redis:6379/0

S3_ENDPOINT=http://objectstore:8333
S3_PRIVATE_ENDPOINT=http://objectstore:8333
S3_PUBLIC_ENDPOINT=https://stg.barghsa.com
S3_REGION=us-east-1
S3_BUCKET=barghsa-staging
S3_ACCESS_KEY_ID=$s3_access_key
S3_SECRET_ACCESS_KEY=$s3_secret_key
S3_FORCE_PATH_STYLE=true

APP_PUBLIC_URL=https://stg.barghsa.com
API_PUBLIC_URL=https://stg.barghsa.com
SESSION_SECRET=$session_secret
CSRF_SECRET=$csrf_secret
PROVIDER_CONFIG_ENCRYPTION_KEY=$provider_key
AUTH_DELIVERY_ENCRYPTION_KEY=$auth_key
AI_MODEL_ENCRYPTION_KEY=$ai_key
STORAGE_CONFIG_ENCRYPTION_KEY=$storage_key
PAYMENT_GATEWAY_ADAPTER=zarinpal
PAYMENT_GATEWAY_MERCHANT_ID=00000000-0000-4000-8000-000000000000
PAYMENT_GATEWAY_WEBHOOK_SECRET=$webhook_secret
NODE_ENV=production
LOG_LEVEL=info
OTP_CONSOLE=false

# Until an off-VPS backup target is configured, staging data is disposable.
BARGHSA_DISPOSABLE=true
EOF
chmod 600 "$runtime"
echo "Created $runtime with random staging secrets" >&2
