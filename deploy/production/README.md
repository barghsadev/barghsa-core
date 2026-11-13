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

### Encrypted deployment configuration

The same manifest accepts protected environment files supplied by the operator or a deployment secret manager. On Linux hosts with `systemd-creds`, use host-key-encrypted files when persisting the inputs to Compose. Generate them on the destination host from protected streams or files. Use a root-only directory and `umask 077`.

```sh
systemd-creds encrypt --with-key=host --name=barghsa-runtime \
  /protected/runtime.env /protected/runtime.cred
systemd-creds encrypt --with-key=host --name=barghsa-migration \
  /protected/migration.env /protected/migration.cred
```

Keep the Compose interpolation file for image references, public settings and the CA path. Pass the two encrypted files separately to the same Compose commands used below.

```sh
python3 deploy/production/compose-with-credentials.py \
  --env-file /protected/rehearsal-compose.env \
  --runtime /protected/runtime.cred --migration /protected/migration.cred \
  config --quiet
```

The launcher resolves the files into private, read-only memory for the local Compose invocation. It verifies that both files use the host-key encryption format and passes the expected names to `systemd-creds`. It uses the same service and migration separation as protected dotenv files. Provision the named credentials again on a replacement host. Protect the systemd host key and retire any plaintext provisioning copies under the deployment secret policy. [systemd credentials](https://systemd.io/CREDENTIALS/).

Docker Engine stores the resolved container environment. Limit Docker access to authorized operators, use encrypted Docker storage and encrypted swap or disable swap, and keep full Compose configuration and container inspect output out of logs and release evidence. Apply rotations by replacing the protected source and recreating the affected services using the existing key-overlap procedure.

## Production release notes template

Copy this outline into the protected production approval package for the exact candidate. Keep customer-facing release notes separate from protected links, contact details and evidence.

| Field                       | Record for this release                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate                   | Version, full source SHA, staging verification receipt, pinned app/web/scanner digests and previous compatible release.                           |
| Changes                     | Shipped changes by service, affected roles and rollout flags.                                                                                     |
| Customer and support impact | Changed workflows, actions customers need to take, expected disruption, and the support response and escalation path.                             |
| Release owner and on-call   | Named release owner, deployment operator, primary and backup responders, coverage window in UTC, and protected paging route.                      |
| Monitoring                  | Working production dashboard and alert links, previous-release baseline, candidate observation window, and the responder for each rollout signal. |
| Runbooks                    | Applicable recovery procedures, halt conditions, last compatible digests, and the owner authorized to halt or roll back.                          |
| Gate evidence               | Exact browser, security, performance, migration, backup and restore receipts. Link the post-deploy smoke and SLO comparison as they are observed. |
| Approval                    | Outstanding gates, proposed rollout window and explicit owner authorization for this version, SHA and target.                                     |

Use the [service objectives](../../docs/operations/service-objectives.md), [incident contacts and recovery procedures](../../docs/operations/incident-response.md), and [deployment rollback runbook](../../docs/runbooks/bad-deployment.md) to fill in the applicable links and triggers. Verify access with the named on-call responders before requesting approval.

## First-launch promotion check

Use a clean checkout of the exact v0.9.0 staging candidate and the full manual CI and browser run IDs for that commit. The check queries the launch board, strict quarantine, hosted workflows, 40-shard browser rollup and live staging readiness. The same hosted CI run must pass the enforced license and combined coverage gates.

Keep `receipt-index.json` in the protected approval package. Set `candidate_sha` to the full candidate SHA. Under `receipts`, map each key below to a nonempty evidence file in the same protected directory or one of its subdirectories.

| Receipt key                    | Evidence to review                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `authenticated_dast`           | Authenticated scan, findings and dispositions.                                             |
| `performance_and_load`         | Representative test inputs, measured outcomes and comparison with budgets.                 |
| `migration_and_rollback`       | Migration and seed results, compatibility and rollback or roll-forward rehearsal.          |
| `backup_and_restore`           | Recent off-server backup, tested restore, RPO and RTO.                                     |
| `rollout_controls`             | High-risk flag or canary plan, halt conditions, and post-deploy smoke and comparison plan. |
| `image_digests_and_scans`      | Pinned runtime digests, image and license scan receipts, SBOMs.                            |
| `provider_and_storage`         | Protected provider, storage, network and TLS readbacks.                                    |
| `security_and_incident_review` | Open finding dispositions, independent assessment and incident coverage.                   |
| `release_notes_and_on_call`    | Completed release notes, monitoring links and on-call coverage.                            |
| `staging_and_telegram`         | Exact staging deployment readback and confirmed Telegram release receipts.                 |

Use JSON indexes for `backup_and_restore` and `staging_and_telegram`. The paths
inside both indexes are relative to the same protected approval package.

- Under `backup_and_restore`, point `backup_job` to the latest successful daily
  job result, `backup_manifest` to its off-server encrypted manifest,
  `restore_report` to the verified database exercise result, and `restore_manifest`
  to the manifest used in that exercise. Add `core_service_report` using the
  format below. The check enforces backup age under 24 hours, a matching database
  system, verified table fingerprints, and the measured recovery limits.
- Under `staging_and_telegram`, point `deployment` to the completed staging
  queue `job.json`, `summary` to the confirmed release-worker message receipt,
  and `album` to its image receipt when available. The check matches the exact
  candidate, channel, Persian notes and queued image hashes. If the queue
  recorded an optional image failure, keep the warning and resolve any unknown
  Telegram delivery through the [staging runbook](../staging/README.md).

In `core_service_report`, set `status` to `passed`, `scope` to
`core_service_recovery`, `candidate_sha` to the full candidate SHA, and
`database_restore_sha256` to the SHA-256 of the original `restore_report` file.
Set `started_at` to the start of the isolated recovery and `completed_at` to
its finish, with timezone offsets. The verifier calculates elapsed time from
these timestamps and enforces the 60-minute core-service limit.

The `checks` object must contain `configuration_restore`, `object_restore`,
`readiness`, `login`, `dashboard`, `wallet`, `electricity`, `saving`, `solar`,
and `consultation`. Record `status`, `verified_at`, `evidence` and
`evidence_sha256` for each check. Use the relative path and hash of the actual
operator output from the [isolated exercise](../../docs/operations/quarterly-recovery-exercise.md).
Verify readiness after the database, configuration and object restores. Verify
login before the owned customer journeys. Keep the independent baseline evidence
with the package for owner review.

```sh
python3 deploy/production/check-promotion.py --ci-run "$CI_RUN" \
  --browser-run "$BROWSER_RUN" --receipt-index /protected/release-evidence/receipt-index.json
```

The report records the SHA-256 of each evidence file and the checked backup and Telegram details. Review the underlying receipts and collect explicit owner authorization for the version, commit and production target before deployment.

## Guarded traffic rollout

After owner approval, provision the candidate without public traffic and keep
the previous verified application pool available. Complete the migration
compatibility rehearsal before starting the ramp. The ingress controls traffic
between those two pools. The migration and job-worker procedures remain
separate from traffic switching. Use the [rollback runbook](../../docs/runbooks/bad-deployment.md)
if traffic cannot be restored and verified.

For `scope.environment` set to `production`, the rollout requires the exact
promotion report and a protected owner authorization record. Save the report
before requesting approval. The record must contain `status` set to `approved`,
the candidate `version` and `candidate_sha`, the exact plan `scope`,
`plan_sha256`, `promotion_report_sha256`, `approved_by`, `approved_at` in UTC
epoch seconds, and `authorization_reference` pointing to the owner's explicit
approval of that plan. Save both JSON files as mode `0600` owned by the rollout
operator, in the protected evidence directory. The guard checks the hashes
before invoking any adapter and checks that the verified backup is still under
24 hours old. An updated plan or report needs matching owner authorization.
The rollout receipt records both hashes without including the approval text.

Use `guarded-rollout.py` on the authorized ingress operator's host. It checks
candidate smoke at zero traffic, advances through the configured percentages
and waits for a fresh observation window at each percentage, including 100.
Smoke failure, elevated API error rate, per-service availability burn, critical
wallet drift or a security alert halts the ramp. Unavailable evidence halts
the ramp, and insufficient volume halts it at the observation deadline. After any attempted
traffic change, a halt requests zero candidate traffic and verifies the
previous pool's readback.

```sh
python3 deploy/production/guarded-rollout.py \
  --plan /protected/release-evidence/rollout-plan.json \
  --receipt /protected/release-evidence/rollout-receipt.jsonl \
  --promotion-report /protected/release-evidence/promotion-report.json \
  --owner-approval /protected/release-evidence/owner-approval.json
```

Prepare one protected JSON plan for the approved environment. Keep plans for
the same ingress in the same directory so they share the rollout lock. Use a
new receipt path for each invocation. The plan contains these fields.

| Field                   | Required contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope`                 | Exact `environment` and `database` labels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `candidate`, `previous` | Each has a full `commit` SHA and the verified platform `app_image` and `web_image` IDs, including the `sha256:` prefix.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `weights`               | Two to ten increasing integer percentages ending at 100. Keep the previous pool available throughout the ramp.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `baseline`              | Previous release's `revision`, the same `scope`, UTC `window_start` and `observed_at` in epoch seconds, plus API and per-service journey counts from a comparable pre-ramp window.                                                                                                                                                                                                                                                                                                                                                      |
| `policy`                | The rollout window and thresholds approved for the environment. Use `availability_tier` of `pilot` or `commercial` for the documented error budgets. Set positive `minimum_api_samples` and `minimum_journey_samples`, `minimum_observation_seconds`, `stage_timeout_seconds`, `poll_seconds`, `hook_timeout_seconds`, `baseline_max_age_seconds` and `observation_max_age_seconds`. Set `max_http_error_ratio`, `max_http_error_increase` over the baseline as fractions, and `max_slo_burn` as a multiple of the tier's error budget. |
| `route`, `observe`      | Argument arrays starting with an absolute executable. Use operator-controlled adapters that finish synchronously and exit nonzero when readback is unavailable.                                                                                                                                                                                                                                                                                                                                                                         |

Both adapters read a JSON request on stdin and write one JSON object on stdout.
Use `scope`, `candidate`, `previous` and `candidate_weight` to bind the
responses to one rollout. Keep credentials in protected configuration.
The baseline also includes `p95_upper_seconds` and, when measurable,
`p99_upper_seconds` from the previous API pool.
Set the approved absolute budget in `max_api_p95_seconds` and permitted
increase in `max_api_p95_increase_seconds` in the rollout policy. These
limits apply to the scoped pool's end-to-end API distribution. The
operation-specific performance checks use their own [service budgets](../../docs/operations/service-objectives.md).

- The route request includes `action` of `read` or `set` and
  `candidate_weight`. Before `set`, verify readiness of the previous pool.
  Apply that absolute percentage and read it back before returning. Include
  `previous_ready` from the compatible pool's current readiness check. On restoration, verify that the ingress
  sends all traffic to that pool and its running images match the prior release.
  The guard reads the route and running image identities before every
  observation.
- The observation request includes `candidate_weight` and `window_start`
  in UTC epoch seconds. Return the actual `window_start`, `observed_at`,
  `smoke`, `api`, `journeys`, `critical_wallet_drift` and `security_alerts`.
  In `smoke`, return a boolean for `health`, `dashboard`, `wallet` and for
  each of `electricity`, `saving`, `solar` and `consultation`. Check the candidate's release
  identity, liveness and readiness and use authorized synthetic journeys.
  Return the completed candidate API requests and server errors as
  `attempts` and `failures` in `api`, with `p95_upper_seconds` and
  `p99_upper_seconds` for latency.
  In `journeys`, return the two counts for
  each service using eligible authenticated attempts, including timeouts and
  dependency failures. Take drift and security counts from their current
  authoritative monitoring sources. During zero-traffic preflight, only
  smoke, drift and security signals are evaluated.

### Configure the observation hook

Point `observe` at the absolute Python executable, the absolute path to
`rollout-observer.py`, and `--config /protected/observer.json`. Give the
operator ownership of that JSON file and mode `0600`. It contains:

- `scope` matching the plan, and `candidate` and `previous` objects with
  `revision` matching the plan, a pool-specific `origin`, and
  `api_job` and `journey_job` names. For the native journey counters, set
  `journey_job` to the pool's `api_job`. Each HTTPS origin serves that pool's
  `/release.json` and API. The observer verifies both live release SHAs
  and matches each API pool to its scraped release metric. The ingress
  hook verifies route weight and running image IDs.
- `user_id`, `profile_id`, `session_id` and a `fixtures` object mapping
  `electricity`, `saving`, `solar` and `consultation` to a known order or
  request ID from that synthetic customer profile. Put the fixture on the
  first page returned by each service. Use a current ordinary customer
  session from the candidate environment. The observer reads the active
  dashboard context, checks wallet access, validates the profile's IRR
  balance response and verifies the four expected records. The receipt
  includes pass or fail signals. Keep the fresh sign-in receipt from the
  synthetic login journey with the operational evidence.
- `prometheus_origin`, `prometheus_token` for a read-only bearer credential,
  `wallet_job` for the reconciliation worker and `targets` mapping each
  distinct job name to its full expected list of Prometheus `instance`
  labels. Set `max_scrape_age_seconds` to cover the configured scrape and
  rule evaluation intervals and allow for normal jitter. Set the guard's
  observation age limit to accommodate that freshness bound.
  `additional_security_rules` can list other deployed security rule names
  to evaluate alongside `PaymentCallbackAnomaly` and
  `PaymentIdempotencyConflict`. Require both scope labels on those alerts.

Label every scrape target with the exact `environment` and `database` in
the plan. Scrape the API histogram, API process start time and revision, and
the worker's wallet reconciliation gauge from their existing endpoints.
The native API exports the eight `barghsa_rollout_journey_attempts_total`
series for its exact build revision and provides the same
`node_process_start_time_seconds` for both API and journey continuity.
Scrape each API replica once. If a pool uses a separate journey collector,
scrape its `process_start_time_seconds` and all eight revision-scoped
success and failure counters. Verify collector coverage against the
[service objectives](../../docs/operations/service-objectives.md).
The authenticated smoke reads check the synthetic account independently of
that availability input.

The synthetic smoke uses read-only health and account requests during a
capability pause. For example, electricity checkout maintenance can reject a
new order while liveness, database readiness and the existing order list
remain available. A failed readiness check still stops the observation.

The observer computes counter deltas from complete scrapes within the
window. Restarts, scope or target changes, missing journey series, scrape
gaps and stale rule evaluations make the observation unavailable. The HTTP
ratio uses completed API responses and their 5xx subset. A lack of measured
traffic leaves the ramp waiting for volume.
The latency comparison uses cumulative bucket deltas over the same measured
window. The smallest finite buckets containing 95% and 99% of requests bound
p95 and p99. Missing buckets or inconsistent counts invalidate the observation.
An unbounded p95 halts the ramp once the minimum sample count is met. The receipt
reports p99 as unavailable below 1,000 completed requests or when the tail
extends beyond the finite buckets. Rollout latency thresholds apply to p95.

Before changing traffic, collect the previous release baseline with
`python3 rollout-observer.py --config /protected/observer.json --baseline-seconds N`.
Use a comparable workload and enough time to meet the plan's minimum
observation and sample thresholds. Review the output and put it in the plan's
`baseline` field. The receipt reports previous and candidate journey burn,
HTTP error ratios, p95 and p99 upper bounds, and the baseline sample window
and counts for each measured stage. A latency
regression after traffic moves triggers restoration of the previous pool.

The protected JSONL receipt records requested and verified traffic, the
observation counts and any halt or rollback. Exit status 0 means the final
window passed, 1 means the ramp halted before requesting a traffic change,
2 means previous traffic was restored and verified, and 3 means restoration
needs operator reconciliation. After an interrupted host or process, read back
the ingress and reconcile the receipt before attempting another ramp. Use
current production topology and telemetry in the launch rehearsal. The
isolated tests use synthetic traffic and metrics.

### Rehearse browser sign-in

Run the native browser smoke with the candidate's compiled web and API.
It creates a disposable PostgreSQL database and reads the one-time code
from that database's encrypted delivery outbox. The browser submits the
normal login and verification forms, reads the owned dashboard and wallet,
and signs out. The fixture checks that the API revoked the session.

```sh
pnpm exec turbo run build --filter=@barghsa/web --filter=@barghsa/api --filter=@barghsa/worker
BARGHSA_TEST_PREBUILT=1 BARGHSA_TEST_POSTGRES_COMPOSE=1 \
  BARGHSA_BROWSER_FIXTURE_LOOPBACK=1 BARGHSA_NATIVE_ROLLOUT_SMOKE=1 \
  node scripts/run-production-browser.mjs e2e/rollout-smoke.spec.ts --project=chromium
```

Retain the passing case and its synthetic Persian dashboard capture. Repeat
the customer sign-in on the exact staged candidate with the authorized
synthetic account and its verified contact. Record the staged release SHA,
rendered dashboard, wallet scope and logout result with the rollout receipt.

## Grafana deployment markers

Run the Grafana annotation step after the guarded rollout completes. Check out
the deployed commit on the approved ingress runner. Use the private Grafana
organization for the target environment so all ten Barghsa dashboards show
the same deployment marker. Each marker records the verified 100% traffic
timestamp, version, commit, named owner, change summary and release notes link.

Keep the annotation configuration owned by the runner with mode `0600`. Set
`scope` to the rollout's environment and database object, `origin` to the
private Grafana HTTPS origin, `token` to the organization annotation service
account token, and `owner` and `summary` to the approved release notes values.
Grant only the annotation creation and read permissions the Grafana edition
supports. A loopback HTTP origin is available for an isolated rehearsal or
an operator's trusted local forwarding session.

```yaml
- name: Publish and verify the Grafana marker
  uses: ./.github/actions/grafana-release-annotation
  with:
    config: /protected/release-evidence/grafana-annotation.json
    receipt: /protected/release-evidence/rollout-receipt.jsonl
```

For an operator-run rollout, execute the same step from the exact checkout.

```sh
python3 deploy/production/record-release-annotation.py \
  --config /protected/release-evidence/grafana-annotation.json \
  --receipt /protected/release-evidence/rollout-receipt.jsonl
```

Retain the printed annotation ID and the protected attempt state next to the
rollout receipt. Reuse that directory when reconciling an uncertain outcome.
The step reads Grafana back before confirming delivery and holds an uncertain
write for operator review. Reconcile the marker with the Grafana operator
before authorizing another attempt. An annotation failure needs separate
monitoring follow-up after the completed rollout. [Grafana annotations API](https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/api-legacy/annotations/).

## Sentry deployment markers

Register the deployed full commit SHA as the Sentry release in each configured project. Associate the exact `barghsadev/barghsa-core` commit through the approved Sentry repository integration. The server and browser events already use that SHA as their release identifier and carry the root version as `release_version`. [Sentry release registration](https://docs.sentry.io/api/releases/create-a-new-release-for-an-organization/) · [Project release commits](https://docs.sentry.io/api/releases/list-a-project-releases-commits/).

Place the release API configuration in a runner-owned file with mode `0600`. Set `origin` to `https://sentry.io` or the organization's regional API origin, `https://us.sentry.io` or `https://de.sentry.io`. Set `organization` to its slug, `projects` to the project slugs for the deployed app, and `token` to the protected release API token with the required project access. Set `scope` to the guarded rollout's `environment` and `database`. The environment for this step is `production`. From the immutable candidate checkout, verify the project associations before requesting production approval. [Sentry API base domains](https://docs.sentry.io/api/#choosing-the-right-api-base-domain).

```sh
python3 deploy/production/record-sentry-deploy.py \
  --config /protected/sentry-release.json --verify-release
```

After the authorized guarded rollout reaches 100% and finishes its readiness observation, run the marker step from that same checkout.

```yaml
- name: Publish and verify the Sentry deployment marker
  uses: ./.github/actions/sentry-release-deploy
  with:
    config: /protected/sentry-release.json
    receipt: /protected/release-evidence/rollout-receipt.jsonl
```

For a rollout run directly by an operator, invoke the same script with `--receipt /protected/release-evidence/rollout-receipt.jsonl` in place of `--verify-release`. Save the verified deployment ID and project readback with the rollout receipt. Keep the private marker state in that same directory when reconciling an uncertain write. A newer Sentry deploy can replace an older marker in the API list, so preserve the original readback with the older receipt. Treat a missing or conflicting marker as an operations follow-up after the completed rollout. [Sentry deployment API](https://docs.sentry.io/api/releases/create-a-deploy/).

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

Run `rollout-observer.py --synthetic --config /etc/barghsa/synthetic.json --metrics-file /var/lib/barghsa-synthetic/probe.prom` on an approved monitoring host outside the application VM. The protected JSON file must be owned by the probe user and mode `0600`. It contains the HTTPS `origin`, the dedicated fixture's `username` and `password`, its expected `user_id` and `profile_id`, and `fixtures` mapping electricity, saving, solar and consultation to existing fixture IDs. Use a non-staff customer whose only accessible profile is the owned, active default fixture profile. The probe verifies the profile list before reading the four existing records. Each authenticated business request is a GET.

Use a `device_token` issued by normal trusted-device enrollment for that account or an approved `otp_reader`. The reader is an absolute executable path owned by root or the probe user and protected against group and world writes. It reads the challenge ID and request time from stdin and returns the six-digit code for that fresh challenge through stdout. Configure its verified contact and credentials separately. There is one login attempt per run and no automatic resend. If the product challenges a trusted device, the check needs the protected reader to complete sign-in.

Run one controlled check before enabling the [five-minute timer](../monitoring/systemd/barghsa-synthetic.timer) and [service](../monitoring/systemd/barghsa-synthetic.service) on the approved host. Use a private node exporter textfile collector for the service's state directory. Scrape only the status, completion timestamp and verified public certificate expiry, with the correct environment and database labels. The probe journal contains fixed outcomes, durations, validated correlation IDs and the certificate expiry timestamp when available. Skipped checks have no success sample. These synthetic metrics are separate from the actual journey attempt counters used in rollout and SLO calculations. Record the live schedule, fixture isolation, scrape and on-call receipts with the operational evidence.

Use the scrape job name `barghsa-synthetic`. The [Prometheus rules](../monitoring/synthetic-probe-alerts.yml) send P1 to the private operations receiver after six minutes of a current failed check. They also report a down target, missing result or a result over 12 minutes old after two minutes. Configure the approved on-call pager route and read back both firing and resolved deliveries. [Journey availability runbook](../../docs/runbooks/journey-availability.md)
