# Hybrid production rehearsal

Use this standalone Compose file for a separate rehearsal environment. It starts the app services without creating a database, pooler, Redis, or object store on the app host. The older overlay on `docker-compose.yml` is a local fixture. Neither file provides a production approval.

Prepare an operator-owned Compose environment with the repository and digest of each verified app, web, and ClamAV image. The digest variables contain the hex digest without the `sha256:` prefix. Pull those exact images before starting services. Supply `BARGHSA_DATABASE_CA_FILE` for the certificate authorities that sign the separate database and pooler certificates. Keep that public CA bundle readable by the image's non-root `node` user. Verify the real hostnames and certificate chains at both hops.

Use two protected files on the app host:

- `BARGHSA_RUNTIME_ENV_FILE` supplies the runtime pooler and direct database URLs, app and API public URLs, provider and encryption settings, and external Redis and object-store configuration. Use only the runtime roles. Keep the application endpoints on loopback behind the TLS proxy, route `/api/` to port 4000, and configure `API_TRUSTED_PROXY_IPS` for the proxy addresses actually seen by the API.
- `BARGHSA_MIGRATION_ENV_FILE` supplies a direct `PGDIRECT_URL` with a separate migration principal. It does not contain application session, storage, or provider secrets. The one-shot migration service uses this file and the same immutable app image as the API and worker. The app starts only after migrations succeed.

Validate the manifest without starting or changing services:

```sh
docker compose --env-file /protected/rehearsal-compose.env \
  -f deploy/production/compose.yml config --quiet
```

Keep `BARGHSA_WEB_CSP_MODE=report-only` during the required reporting window. Follow the [browser CSP policy](../../docs/security/content-security-policy.md). Switch to `enforce` only after checking sanitized reports and exercising the real customer and staff routes. Return to `report-only` to roll back policy enforcement without disabling collection.

Record the positive TLS connection and a rejected wrong hostname or untrusted CA, network denial from an unauthorized host, failed-migration startup behavior, successful migration and seed receipts, and healthy app and worker readback. Repeat the [backup and restore rehearsal](../../docs/operations/backup/postgresql-restore-runbook.md) with authenticated off-server storage and an independent fingerprint. The Compose file and disposable staging tests do not establish those operational results.
