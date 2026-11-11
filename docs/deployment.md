# Deployment guide

## Prerequisites

Use a Docker and Compose host with protected configuration, verified TLS,
private database and object storage, and working health probes. Confirm the
backup destination and rehearse a restore before using durable data. Record
the accepted source commit, exact image IDs, registry digests, security
reports and release metadata. [Production prerequisites](../deploy/production/README.md).

## Environment and service configuration

Use the annotated environment template for the application variables and the
selected Compose file for deployment-only variables. Keep runtime, migration
and initial administrator bootstrap configuration in separate protected
files. Use the bootstrap credentials only for initial provisioning.
[Environment variables](../.env.example) · [Production Compose](../deploy/production/compose.yml).

| Deployment variables                                                                       | Purpose                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `BARGHSA_APP_REPOSITORY`, `BARGHSA_WEB_REPOSITORY`, `BARGHSA_CLAMAV_REPOSITORY`            | Registry repositories for the production app, web and scanner images.                                                        |
| `BARGHSA_APP_DIGEST`, `BARGHSA_WEB_DIGEST`, `BARGHSA_CLAMAV_DIGEST`                        | Verified registry digests for those images, with the `sha256:` prefix omitted.                                               |
| `BARGHSA_APP_IMAGE`, `BARGHSA_WEB_IMAGE`, `BARGHSA_CLAMAV_IMAGE`, `BARGHSA_POSTGRES_IMAGE` | Exact image references used by the staging release worker. The worker loads them on the host before starting the services.   |
| `BARGHSA_RUNTIME_ENV_FILE`, `BARGHSA_MIGRATION_ENV_FILE`                                   | Protected paths for application runtime configuration and the separate migration principal.                                  |
| `BARGHSA_DATABASE_CA_FILE`                                                                 | CA bundle for the database and pooler TLS certificates.                                                                      |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`                                        | Staging PostgreSQL database and protected credentials. Keep the configured identities aligned with the initialized database. |
| `BARGHSA_PROXY_IPS`                                                                        | Staging proxy addresses trusted by the API. Use the addresses of its actual proxy peers.                                     |
| `BARGHSA_WEB_CSP_MODE`                                                                     | Browser CSP rollout mode. Use `report-only` through the observation window and `enforce` after the required review.          |

| Service                             | Configuration reference                                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reverse proxy                       | [Pilot TLS proxy](../deploy/pilot/README.md) and [staging routing, TLS and smoke procedure](../deploy/staging/README.md).                                                     |
| PostgreSQL and pooler               | [Connection pooling](adr/002-connection-pooling.md), [database TLS and host boundaries](adr/003-hybrid-deployment.md), and [staging tuning](../deploy/staging/postgres.conf). |
| Redis                               | [Cache, quota and fallback policy](adr/002-redis-scope.md) and [local configuration](../docker-compose.yml).                                                                  |
| MinIO or private S3                 | [Local bucket initialization](../docker-compose.yml) and [provider, credentials and object controls](operations/storage-configuration.md).                                    |
| PostgreSQL and configuration backup | [Database restore](operations/backup/postgresql-restore-runbook.md) and [off-host configuration recovery](operations/backup/config-restore-runbook.md).                       |

### Runtime overrides

| Runtime overrides                                                                                                       | Purpose                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DB_POOL_MIN`, `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT`                                                                   | Default connection pool bounds and connection timeout in milliseconds.                                                                                 |
| `EXPECTED_MIGRATION_ID`                                                                                                 | Last migration tag expected from the exact candidate journal.                                                                                          |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`                                                                            | Host, port and protected password for the API's Redis host-based configuration.                                                                        |
| `S3_PRIVATE_ENDPOINT`, `S3_PUBLIC_ENDPOINT`                                                                             | Internal object store endpoint and public endpoint used for signed object access.                                                                      |
| `HOST`, `SHUTDOWN_GRACE_PERIOD_MS`, `WEB_CSP_MODE`                                                                      | Standalone web bind address, graceful shutdown budget and effective CSP mode.                                                                          |
| `AI_INFERENCE_HOST`, `AI_INFERENCE_PORT`                                                                                | Private listener address and port for the separate inference process.                                                                                  |
| `CUSTOMER_TELEGRAM_BOT_TOKEN`, `CUSTOMER_TELEGRAM_TRANSPORT`, `CUSTOMER_TELEGRAM_WEBHOOK_SECRET`                        | Protected customer bot credential, transport selection and inbound webhook authentication. [Telegram host configuration](operations/telegram-host.md). |
| `OPS_ALERT_WEBHOOK_SECRET`, `OPS_ALERT_ENVIRONMENT`, `OPS_ALERT_DATABASE`, `OPS_ALERT_PORT`                             | Protected operations receiver credential, accepted environment and database labels, and private listener port.                                         |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_METRIC_EXPORT_TIMEOUT` | OTLP metric collector, service label, export interval and timeout. Intervals and timeouts use milliseconds.                                            |
| `OUTBOX_POLL_MS`, `INVITATION_EXPIRY_SCAN_MS`, `WALLET_RECONCILIATION_SCAN_MS`                                          | Worker polling intervals for the outbox, invitation expiry and wallet reconciliation in milliseconds.                                                  |
| `INVOICE_OVERDUE_SCAN_MS`, `INVOICE_REMINDER_SCHEDULE_MS`, `INVOICE_REMINDER_SEND_MS`                                   | Invoice overdue, reminder scheduling and reminder sending intervals in milliseconds.                                                                   |
| `SERVICE_BREACH_SCAN_MS`, `SERVICE_ESCALATION_SCAN_MS`                                                                  | Service target breach and escalation scan intervals in milliseconds.                                                                                   |
| `SAVING_BILL_VERIFICATION_URL`, `SAVING_BILL_VERIFICATION_TOKEN`                                                        | Saving bill verifier endpoint and protected credential.                                                                                                |
| `SMSIR_API_BASE`                                                                                                        | SMS.ir base URL used by the worker's credit monitor.                                                                                                   |
| `STEP_UP_WINDOW_MS`                                                                                                     | Freshness window for step-up authorization in milliseconds.                                                                                            |
| `ENABLE_VERIFICATION_STUB`, `TEST_SEND_ALLOWLIST`                                                                       | Explicit development and test overrides for the verification stub and authorized notification test destinations.                                       |

Configure the electricity and saving bill providers with trusted HTTPS origins
and protected tokens. Both adapters refuse redirects and reject response bodies
larger than 2 MiB. Saving can fall back to staff review. Electricity keeps
manual entry available when the provider fails.

Each bill adapter keeps its own circuit on each API replica. Five failed
operations within 60 seconds open the circuit by default. After 120 seconds
the adapter allows one recovery operation under its existing request timeout.
Use the `BILL_PROVIDER_CIRCUIT_*` settings in `.env.example` to change the
threshold, window and cooldown. Private Grafana shows the state per replica and
the failure share of admitted operations. Saving counts the result after its
bounded retry. [External Providers dashboard](../deploy/monitoring/grafana-external-providers-dashboard.json).

Set `ROUTE_ERROR_SENTRY_DSN` for browser route failures and
`SERVER_ERROR_SENTRY_DSN` for API and worker exceptions in the protected
runtime environment. Use the approved HTTPS project for each environment.
Each event carries a fixed diagnostic code, process name, deployment environment
and valid build SHA. API events can include the matched route template. Browser
events include the generated support reference. Messages, stacks, cookies,
request values and job payloads stay out of the envelope.

Development and staging sample every eligible event. Production samples 10%
by default. Set `SENTRY_ERROR_SAMPLE_RATE` to a fraction from 0 to 1 to change
the production rate. The browser diagnostic endpoint returns 204 for a matching
receipt, 202 for a sampled-out event and 503 when delivery could not be confirmed.
Browser and server delivery each allow four concurrent requests per process with
a three-second deadline. The API returns its error response before sending the
server event. Operator logs and durable job recovery remain available during a
receiver outage.

## Pilot and staging

1. Prepare a dedicated pilot host with Docker Compose 2.24.4 or later, a valid
   certificate chain, and private S3 storage. Keep application settings in
   `/protected/pilot-runtime.env`. In
   `/protected/pilot-compose.env`, set `POSTGRES_PASSWORD`, `MINIO_ACCESS_KEY`,
   `MINIO_SECRET_KEY`, and the backup endpoint, bucket, credentials, cluster ID,
   and key-file path required by the
   [backup runbook](operations/backup/postgresql-restore-runbook.md).
   Use a private HTTPS backup bucket outside the pilot host and make the
   mounted passphrase file readable by the container's PostgreSQL user.
   Set `BARGHSA_RELEASE_SHA` to the full reviewed source commit before
   building the application images.

   ```bash
   export BARGHSA_RUNTIME_ENV_FILE=/protected/pilot-runtime.env
   pilot=(docker compose --env-file "$BARGHSA_RUNTIME_ENV_FILE"
     --env-file /protected/pilot-compose.env
     -f docker-compose.yml -f docker-compose.prod.yml)
   "${pilot[@]}" config --quiet
   "${pilot[@]}" up -d --wait postgres pgbouncer minio
   "${pilot[@]}" run --rm minio-init
   ```

   Apply the packaged migrations with the separate migration principal before
   starting the application services. Verify encrypted WAL readback, a full
   backup, and restore before accepting traffic. Schedule the daily backup
   through the backup runbook. Start the stack with `"${pilot[@]}" up -d`.
   PostgreSQL and PgBouncer are private to Compose. The API, web, and local
   object store publish only on loopback. For remote browsers, configure a
   browser-reachable HTTPS S3 endpoint and its allowed origins. To enable the
   optional cache, use `--profile cache` and set `REDIS_URL=redis://redis:6379`
   in the application environment. [Pilot overlay](../docker-compose.prod.yml).

2. Install the pilot TLS proxy with the selected hostnames and certificate
   paths. Validate its configuration before reload. Confirm that private
   services stay behind the application and storage access boundaries.
   [Pilot proxy instructions](../deploy/pilot/README.md).
3. For Barghsa staging, verify the accepted release SHA on `main` and enqueue
   the immutable release worker. Check its health, deployed metadata and
   Persian notification receipt for the same SHA. [Staging release worker](../deploy/staging/README.md#release).

## Commercial high availability

Use two failure domains, stateless API and web replicas behind a managed load
balancer, redundant workers and managed PostgreSQL with the required recovery
path. Verify hostname and certificate validation for both database hops.
Rehearse migration, startup failure, readiness, failover and restore using the
pinned production manifest and an isolated environment. Obtain explicit owner
authorization before production promotion. [Topology decision](adr/004-deployment-topology.md) · [Production rehearsal](../deploy/production/README.md).

## Upgrade

1. Verify the current backup, migration compatibility and candidate digests.
   Record the current images and configuration as the rollback point.
2. Apply the candidate migrations using the separate migration principal and
   the candidate's packaged migration runner. Confirm the expected migration
   tag before starting its application services.
3. Check readiness, liveness and release metadata, then use the approved
   rollout and traffic controls. Compare errors, latency and reconciliation
   with the pre-deploy baseline before increasing traffic.

See the exact staging and hybrid procedures for command order and receipts.
[Staging deployment](../deploy/staging/README.md) · [Production migration and probes](../deploy/production/README.md).

## Rollback

Use the last verified image digests and configuration. Check compatibility
with the current schema before returning traffic. If committed writes need
recovery, isolate and restore from the verified backup or WAL target and
reconcile the affected ledgers, records and outbox before resuming service.
[Application, configuration and data rollback](runbooks/bad-deployment.md) · [Database restore](runbooks/database-restore.md).

## Capability maintenance

Use `/admin/maintenance` to pause new actions in a single capability. Record the owner, future return time, and rationale in Persian and English. Clear **Show the reason to customers** to use the standard notice and retain the rationale in the restricted audit history. When editing an existing pause that uses the standard notice, supply the rationale for the new decision. Existing support and account access remain available.

## Monitoring and release readback

Configure Prometheus scrapes, Alertmanager routing and the relevant Grafana
views. Verify availability, latency, database and pooler health, backlog age,
delivery failure and payment reconciliation. Exercise the alert and recovery
paths and retain the actual routing receipt. Keep deployment identity in the
post-deploy comparison. [Monitoring configuration](../deploy/monitoring/staging-compose.yml) · [Notification dashboard](../deploy/monitoring/grafana-notifications-dashboard.json) · [Service objectives](operations/service-objectives.md) · [Incident response](operations/incident-response.md).

Use `docker logs --details <container>` to read the
`org.opencontainers.image.revision` attribute alongside application log lines.
The API, worker, inference, and web images carry this label from the build.
It matches the full SHA used in release metadata and error reports. Compose
passes the revision label to the JSON log driver.
