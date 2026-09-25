FROM node:24-bookworm-slim AS node
FROM ghcr.io/chrislusf/seaweedfs@sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882 AS seaweed
FROM pgvector/pgvector:pg18

COPY --from=node /usr/local /usr/local
COPY --from=seaweed /usr/bin/weed /usr/local/bin/weed
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates clamav clamav-daemon clamav-freshclam curl \
    nginx poppler-utils python3 redis-server \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/api /app/worker /app/web

COPY api.tar.gz worker.tar.gz web.tar.gz /tmp/
RUN tar -xzf /tmp/api.tar.gz -C /app/api \
    && tar -xzf /tmp/worker.tar.gz -C /app/worker \
    && tar -xzf /tmp/web.tar.gz -C /app/web \
    && rm /tmp/*.tar.gz
COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/start.sh /usr/local/bin/healthcheck.sh

ENV NODE_ENV=production NODE_OPTIONS=--max-old-space-size=512 \
    PGDATA=/data/postgres S3_BUCKET=barghsa-stg S3_REGION=us-east-1 \
    S3_FORCE_PATH_STYLE=true S3_ENDPOINT=http://127.0.0.1:8333 \
    S3_PRIVATE_ENDPOINT=http://127.0.0.1:8333 \
    S3_PUBLIC_ENDPOINT=https://s3.barghsa.com \
    DOCUMENT_CLAMAV_HOST=127.0.0.1 DOCUMENT_CLAMAV_PORT=3310 \
    APP_PUBLIC_URL=https://app.barghsa.com API_PUBLIC_URL=https://app.barghsa.com
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 CMD /usr/local/bin/healthcheck.sh
ENTRYPOINT ["/usr/local/bin/start.sh"]
