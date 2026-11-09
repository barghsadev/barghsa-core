# Hybrid production rehearsal

Use this standalone Compose file for a separate rehearsal environment. It starts the app services without creating a database, pooler, Redis, or object store on the app host. The older overlay on `docker-compose.yml` is a local fixture. Neither file provides a production approval.

Deploy the commercial topology across two failure domains and measure failover against its recovery target. [Commercial high availability](../../docs/adr/003-hybrid-deployment.md#6-commercial-high-availability).

Prepare an operator-owned Compose environment with the repository and digest of each verified app, web, and ClamAV image. The digest variables contain the hex digest without the `sha256:` prefix. Pull those exact images before starting services. Supply `BARGHSA_DATABASE_CA_FILE` for the certificate authorities that sign the separate database and pooler certificates. Keep that public CA bundle readable by the image's non-root `node` user. Verify the real hostnames and certificate chains at both hops.

Retain the vulnerability report, CycloneDX SBOM, image scan receipt, and release license report for the exact images proposed for promotion. After approved registry publication, record the immutable source revision tag and its registry digest for each image. Pull the digest for the rehearsal host's architecture and compare `docker image inspect --format '{{.Id}}'` with `image_id` in the scan receipt. Verify the report and SBOM checksums against that receipt. A mismatch requires scanning the actual candidate and rechecking the license report before promotion. Update `latest` only after promotion is approved. Use the pinned digest for deployment and rollback.

Use two protected files on the app host:

- `BARGHSA_RUNTIME_ENV_FILE` supplies the runtime pooler and direct database URLs, app and API public URLs, provider and encryption settings, and external Redis and object-store configuration. Use only the runtime roles. Keep the application endpoints on loopback behind the TLS proxy, route `/api/` to port 4000, and configure `API_TRUSTED_PROXY_IPS` for the proxy addresses actually seen by the API.
- `BARGHSA_MIGRATION_ENV_FILE` supplies a direct `PGDIRECT_URL` with a separate migration principal. Set `EXPECTED_MIGRATION_ID` to the final migration tag in the candidate's packaged journal. The migration file contains no application session, storage, or provider secrets. The one-shot migration service uses this file and the same immutable app image as the API and worker. The app starts only after migrations succeed.

Validate the manifest without starting or changing services:

```sh
docker compose --env-file /protected/rehearsal-compose.env \
  -f deploy/production/compose.yml config --quiet
```

From the exact candidate checkout, run the strict quarantine check before seeking production approval. Retain the JSON report with `promotion_check` set to `true` and `status` set to `passed` in the approval package.

```sh
scripts/check-flaky-tests.sh --promotion \
  --report /protected/release-evidence/flaky-test-report.json
```

## Initial database seed

After the owner approves initial provisioning, use the pinned app image and separate migration principal to migrate and seed a new database before starting the app services. Put only `ADMIN_BOOTSTRAP_SECRET`, `ADMIN_BOOTSTRAP_KEY`, `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` in a root-owned `0600` bootstrap environment file. Keep the direct connection and CA in the existing migration configuration.

```sh
docker compose --env-file /protected/rehearsal-compose.env \
  -f deploy/production/compose.yml run --rm --no-deps -T migrate &&
docker compose --env-file /protected/rehearsal-compose.env \
  -f deploy/production/compose.yml run --rm --no-deps -T \
  --env-from-file /protected/bootstrap.env migrate node run-packaged-seed.cjs
```

Retain the migration and seed results, verify one audited administrator bootstrap, then retire the bootstrap credentials. Ordinary deployments use the migration service. A retry during initial setup preserves an administrator who was already created.

The administrator starts with a five-minute password-change flow. Repeating the temporary sign-in rotates the outstanding change token. Changing the password clears that token and invalidates the temporary password. A fresh sign-in with the new password and staff OTP establishes the session.

Keep `BARGHSA_WEB_CSP_MODE=report-only` during the required reporting window. Follow the [browser CSP policy](../../docs/security/content-security-policy.md). Switch to `enforce` only after checking sanitized reports and exercising the real customer and staff routes. Return to `report-only` to roll back policy enforcement without disabling collection.

Record the positive TLS connection and a rejected wrong hostname or untrusted CA, network denial from an unauthorized host, failed-migration startup behavior, successful migration and seed receipts, and healthy app and worker readback. Repeat the [backup and restore rehearsal](../../docs/operations/backup/postgresql-restore-runbook.md) with authenticated off-server storage and an independent fingerprint. The Compose file and disposable staging tests do not establish those operational results.

## Synthetic health probes

Probe `GET /api/health/live` without credentials to verify the process can serve requests. Probe `GET /api/health/ready` for traffic admission. Treat PostgreSQL or schema failure as a readiness failure. The response can report degradation for optional dependencies while the API continues to serve traffic.

Use a dedicated customer test account and its protected verified contact for the authenticated journey. Bootstrap CSRF through `GET /api/auth/csrf`, sign in through `POST /api/auth/login`, and complete `POST /api/auth/login/verify` when challenged. Use the returned cookies to read `GET /api/auth/user` and verify only the expected test account identity. Sign out through `POST /api/auth/logout` with the active CSRF proof. Keep credentials, contact values and response bodies out of monitoring output. Report status, duration and the response correlation ID. The probe makes no financial or customer-profile changes.
