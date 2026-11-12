# Notification delivery monitoring

`EmailProviderDegraded` and `SmsProviderDegraded` alert when an active provider's persisted health is zero. Replica series are combined per provider; a healthy sample from one replica cannot hide a degraded sample from another. Retired configuration versions do not emit health series. A healthy tested replacement therefore resolves the old alert while preserving the retired version's configuration-pause history. Local Prometheus rule tests cover healthy, tripped, replica disagreement and recovery states. Acceptance requires actual Alertmanager firing/recovery and native delivery receipts recorded in the board.

The email and SMS provider APIs return the last hour of attributable attempt
and failure counts, average latency and p50, p95 and p99 latency by provider
configuration. The views show attempts and the failure rate. Successful
attempts are the total less failed or uncertain attempts. Channel backlog is
shared across configurations. The private worker scrape publishes the current
circuit state for each active configuration. A recovery that reuses an accepted
receipt produces no new provider latency sample.

The External Providers dashboard combines private worker and API scrapes for
email, SMS and AI. Worker latency and error share cover admitted durable sends
through the provider result. A recovered receipt produces no extra sample, and
a receipt write failure after acceptance leaves the provider result classified
as accepted. Auth OTP traffic, operator provider tests and downstream delivery
feedback have their own monitoring paths. The dashboard shows the last observed
SMS credit and its age, plus the fraction used of each configured AI token and
USD limit. Missing credit observations and unlimited AI budget dimensions have
no series. [External Providers dashboard](../../deploy/monitoring/grafana-external-providers-dashboard.json).

Migration0130 adds bounded failure timestamps. Drain older API and email-sending worker instances, apply the migration, then start the updated fleet together. Older writers do not maintain these timestamps. Legacy counters retain their earliest recorded window time conservatively; individual historical failure times cannot be reconstructed. Exact rolling evidence accumulates after rollout. Existing degraded states and probe ownership are preserved.

The default email and SMS circuits open after five consecutive transient provider failures inside a rolling 60-second window. The default cooldown is 120 seconds, followed by a single 30-second recovery lease shared across API and worker replicas. Set the three `NOTIFICATION_PROVIDER_CIRCUIT_*` values in the shared runtime environment to adjust the threshold, window and cooldown. An expired probe cannot start a send or mark the provider recovered. A recorded failure from the current probe restarts the cooldown. An expired lease allows the next probe. Permanent provider rejections interrupt a healthy transient failure sequence. A configuration pause requires a tested replacement. Local ownership and persistence failures do not degrade the provider. Accepted delivery remains a provider success when saving its receipt fails. Reconcile uncertain outcomes before any resend.

Confirmed configuration failures instead set `degraded_reason=provider_configuration_pause` with no cooldown. HTTP401, typed Resend credential/permission failures, permanent SMTP authentication or MAIL FROM rejection, and SMS.ir credential/account/IP statuses10–14, invalid-line101, missing-template113, template-plan119 and sender-activation123 pause that provider version immediately. SMTP RCPT TO failures and generic validation failures remain local; provider response messages are never parsed to infer authority or retry safety. SMS.ir recipient statuses104/115, parameter114, content117 and low-credit102 do not request a configuration pause. Credit monitoring retains its own P2 policy. The code uses the provider's [published status table](https://sms.ir/rest-api/) and [Resend's error reference](https://resend.com/docs/api-reference/errors).

Create a corrected draft, pass its configuration-bound connection and delivery tests, then activate it through the existing audited replacement flow. Waiting, a successful stale send, or an old binary's recovery probe cannot clear this pause. Migration0275 preserves all existing provider rows and adds database guards against clearing the pause or setting a probe deadline after application rollback. The existing provider-degraded metric and alert remain active until a healthy replacement becomes active. HTTP failures with no acceptance receipt remain uncertain even when their diagnostic proves a configuration problem; correcting configuration does not authorize resending them.

To reuse a historical email or SMS configuration, select **Restore as draft**
and complete staff step-up. The audit records the source and new draft IDs.
The restored draft starts untested. The active provider serves traffic until
activation. Run a separate delivery test to your verified staff contact,
then activate the draft after the test passes. A failed test stays visible on
the draft. Activation records the provider it replaced and preserves both
historical versions.

The worker exposes delivery metrics on its private `/metrics` endpoint. Import `deploy/monitoring/grafana-notifications-dashboard.json` and load `deploy/monitoring/notification-alerts.yml` in the monitoring stack's `rule_files`. The staging stack and protected receiver are defined below. Production monitoring still needs its own approved configuration and operational evidence.

## Protected staging operations receiver

The owner authorized creation of the missing staging operations configuration. `deploy/monitoring/staging-compose.yml` runs Prometheus, Alertmanager and an independent operations process on `barghsa-staging-private`. Prometheus and Alertmanager publish only loopback ports. The operations process has no published host port and remains available when the application worker stops.

Apply migration `0277_operations_alert_receipts` before starting the receiver or updated notification worker. Start the receiver from the accepted immutable application image with `node worker/dist/operations/server.js`. Keep its database credentials and `OPS_ALERT_WEBHOOK_SECRET`, `OPS_ALERT_ENVIRONMENT=staging` and `OPS_ALERT_DATABASE=core` in `/etc/barghsa/staging/operations.env`, readable only by root. Use a randomly generated secret of at least 32 characters. Put the identical token in `/etc/barghsa/staging/operations-webhook-token`, mounted read-only for Alertmanager. The host directory remains root-only; the token file must be readable by Alertmanager's container UID with no group/world access. Never place these values in Git, command arguments or alert annotations.

Use a dedicated database role with schema usage, execution of `public.lock_operations_alert_admins()`, insertion into `operations_alert_receipts`, `notification_outbox` and `notification_job`, selection of non-secret operations receipts, and selection of returned outbox IDs, the outbox occurrence key and job channel/outbox IDs. The narrowly defined function holds current administrator identities without giving the receiver user-update privileges; its schema references and search path are fixed and public execution is revoked. The role needs no user-table access, financial-table access, inbox access, credential hashes, receipt updates or deletes. Verify its actual grants before activating the receiver.

Provision the protected files and `barghsa_staging_operations` login role before startup. The environment file must be root-owned0600; the matching Alertmanager token must be UID65534-owned0400 under the root-only directory. Verify that effective user read/update and invoice read/insert grants are denied. Apply `/etc/barghsa/staging/operations-grants-after-migration.sql` after migration0277. Configuration provisioning alone does not prove alert delivery.

Set immutable `BARGHSA_APP_IMAGE`, `BARGHSA_PROMETHEUS_IMAGE` and `BARGHSA_ALERTMANAGER_IMAGE` references in the protected Compose environment. The current checked tool images are Prometheus3.15.0 at `sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e` and Alertmanager0.34.1 at `sha256:e9733bafb1bdef9b00e25a21f8f99dc26a22224bf16641ad754d1649f4c3357a`. These image/config checks do not certify deployment.

Alertmanager posts to the private `/operations/alerts` endpoint with bearer authentication and sends recovery notifications. The receiver rejects browser credentials, other environment/database scopes, unknown alerts, malformed identities, mismatched severity, missing SMS P2 priority and oversized bodies. It discards free-form annotations and URLs. Email/SMS/AI circuit outages and worker unavailability publish the original `system.service_outage` event to private admin inbox/email channels. Low credit and dead-letter warnings publish an immediate private `admin.operations_alert` inbox notice; they do not falsely claim an outage. An immutable receipt and its delivery intents commit together. Failed writes roll everything back; repeats preserve the original audience, content, read state and delivery identity. Current admin authority and the protected receipt are checked again before delivery. This does not broadcast operational notices to customers or ordinary staff.

Keep the original notification thresholds and delays. The additional `WorkerUnavailable` rule observes a failed worker scrape for one minute. Record real worker scrapes and controlled firing/recovery receipts for the email circuit, SMS P2 credit and dead-letter rules. Observe their full configured delay. An authenticated test POST proves the receiver path, while a Prometheus-generated receipt proves a rule evaluation and Alertmanager delivery. Record those separately, and verify actual inbox/email receipts before claiming native delivery. Use only an explicitly authorized external test destination; receipt or fixture success does not authorize mail fanout.

For a controlled staging rehearsal, persist a protected fixture identity and original provider state before injecting faults. Label synthetic dead-letter rows and audit their fixture origin. Resolve only those rows through the authorized native triage endpoint with recent step-up; preserve unrelated failures and all delivery history. Native breaker failure injections test the persisted state and monitoring path, while an injected successful probe does not prove an external provider send. A controlled low-credit flag tests the P2 rule without changing the observed vendor balance or polling deadlines. Restore test faults in a finalizer, revoke fixture sessions and verify restoration independently. Retain the original alert delays and cooldowns. Honor current external-channel preferences, and distinguish delivered inbox receipts from skipped email channels.

A configuration-pause rehearsal may use isolated provider tables in the staging database with the deployed provider schema, constraints, foreign keys and all native triggers. Use the matching compiled native provider service, real TLS/authenticated SMTP and a private fixed-recipient mailbox. Trust the fixture CA and allow its exact SMTP host only in ephemeral proof clients. Keep the active application provider rows unchanged. Add a temporary private native-metrics scrape target, verify correlated rule/Alertmanager/inbox firing and recovery, then restore the original monitoring configuration. The corrected version must pass its actual delivery test before activation, and the superseded version must retain its pause. Never manufacture activation proof or clear a paused version. Retain protected fixture receipts and audits, revoke the fixture session and stop its temporary processes after verification.

Validate configuration with `promtool check config`, the existing `promtool test rules` file and `amtool check-config`. Start the staging monitoring stack only against its accepted image and protected configuration. Binary rollback can retain the additive receipt table; its history remains append-only. Acceptance and actual deployment/notification receipts belong in `kanban/board.json`.

The optional watchdog overlay sends the monitoring heartbeat to an independent receiver. Follow the [alert delivery watchdog runbook](../runbooks/alert-delivery.md) for protected configuration and missing-heartbeat and recovery receipts.

### Independent synthetic runner

Once the independent runner and its private HTTPS exporter are approved, add
`staging-synthetic.yml` after `staging-compose.yml` in the staging monitoring
Compose command. Set `BARGHSA_SYNTHETIC_TARGETS_DIR` to a protected, operator-owned
directory. Its `staging.yml` must list the approved exporter address as a
Prometheus file discovery target.

```yaml
- targets: ['synthetic-runner.example.test:9100']
```

Allow connections only from the approved monitoring network. The hostname
must match a certificate trusted by the Prometheus image. Prometheus assigns
the staging and core labels and ingests only the probe result, completion
timestamp and verified public certificate expiry from the exporter. Check that the `barghsa-synthetic` target is up
and publishing fresh results before relying on its alerts. Verify a controlled
failure, a reporting outage, both recoveries and the authorized pager receipt.
[Synthetic runner setup](../../deploy/production/README.md#synthetic-health-probes)

### Operator dashboards

Add `deploy/monitoring/staging-dashboards.yml` after `staging-compose.yml` when
starting the accepted staging monitoring configuration. Set the approved Grafana
image digest as `BARGHSA_GRAFANA_IMAGE` in the protected Compose environment.
Review the Linux platform manifest and scan that exact digest before pulling it
onto staging. Include bundled backends in the review, including Prometheus.
Keep the registry digest and scan evidence with the board receipt.
Place the initial Grafana admin password at
`/etc/barghsa/staging/grafana-admin-password`, readable by the image's runtime
UID only. Use the admin account to provision named operator accounts.
[Grafana Docker secrets](https://grafana.com/docs/grafana/latest/setup-grafana/configure-docker/).

Grafana listens on the staging host's loopback port 3009. Authorized operators
forward local port 3009 to that port over SSH, then sign in. The overlay
provisions ten dashboards in Barghsa Operations with the private Prometheus
source. These include Executive SLO, API Health, PostgreSQL and Connection Pool,
Worker Health, External Providers, Authentication and Security, Finance Safety,
Storage and Uploads, Notifications, and AI Usage. Select the environment and
database in Storage and Uploads. Upload counts and size buckets come from
verified object bytes. The malware panel counts committed infected verdicts.
The queue panel reads active jobs and combines duplicate database observations
from worker replicas. The overlay sets
`OPS_ALERT_DASHBOARD_ORIGIN=http://127.0.0.1:3009` on the staging receiver. In
production, set this variable to the approved HTTPS monitoring origin.
[Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/).

Open the dashboard and runbook links from a fresh staff inbox receipt. Verify
the same links in email for outages where email is enabled. The receiver
derives both destinations from the alert name and protected configuration.
Existing receipts keep their original content and read state. Confirm access
from an operator account and keep anonymous Grafana access disabled.

Select the intended Prometheus instance in the dashboard's **Prometheus** data-source selector. Its failure-ratio panel uses fractional values: warning at 0.10 and critical at 0.25, displayed as 10% and 25%. The open-dead-letter panel retains count thresholds. This follows Grafana's [data-source variable](https://grafana.com/docs/grafana/latest/visualizations/dashboards/variables/add-template-variables/) and [threshold](https://grafana.com/docs/grafana/latest/panels-visualizations/configure-thresholds/) configuration. A September12 local check imported the unchanged dashboard into Grafana11.2.0 with Prometheus3.5.0 and synthetic samples. All five queries returned data; Chromium rendered the selected data source,90s age,12 queued,3 dead letters and an orange12.5% failure ratio. This verifies local dashboard compatibility, not deployed worker scrapes or alert delivery. See the [historical review screenshot](https://github.com/barghsadev/barghsa-core/blob/fcd7678ba742fbbaa7cd0907471f3f2aec86bb82/audit/evidence/r02-outbox-delivery/grafana-dashboard.png).

The rules use the maximum open dead-letter count across worker replicas, rather than summing copies of the same database count. They remove only `instance` and `pod` labels. Keep identical remaining labels for replicas of one database and distinct environment/database labels for separate deployments.

Compare oldest pending age with oldest eligible age when investigating backlog. The eligible series uses the same replica aggregation as the backlog alerts. The processing and retry panel shows leased outbox rows processed per second and committed channel retries scheduled per second. Prometheus calculates the rate per replica before summing by environment and database so worker restarts do not turn counter resets into spikes. [Prometheus rate](https://prometheus.io/docs/prometheus/latest/querying/functions/#rate).

The Resend bounce panel follows attempts started in the trailing 24 hours that have a durable provider acceptance receipt. A verified bounce from the same provider configuration and message counts once, including when its callback arrived before the receipt. SMTP and uncertain sends are outside this cohort. A zero means there are accepted sends with no matching bounce observed so far. An empty cohort shows no data. Check Resend webhook health when interpreting the panel.

- Any open failure lasting 10 minutes raises `NotificationDeadLettersPending`.
- At least 20 open failures lasting 5 minutes raises `NotificationDeadLettersAccumulating`.

These are initial thresholds in the rule file. Tune them against measured delivery volume. Configure Alertmanager to inhibit the warning while the critical alert fires for the same environment/database scope. Retain monitoring-stack alerts for failed scrapes and missing targets; absent notification samples do not prove an empty queue.

On an alert, open `/admin/failed-notifications`, inspect the masked record and per-channel delivery history, and check the provider's health and the worker errors. Retry only after correcting a retryable cause. Retry preserves the occurrence identity and saved delivery snapshot; it requests another attempt, not confirmed delivery. Resolve and Dismiss do not resend. Do not edit outbox/job rows manually to clear an alert.

Validate the files locally with Prometheus's `promtool`:

```sh
promtool check rules deploy/monitoring/notification-alerts.yml
promtool test rules deploy/monitoring/notification-alerts.test.yml
```

Local rule checks prove expressions, thresholds, delay, recovery and replica/environment handling. Before operational acceptance, the deployment owner must load these rules, verify worker scrapes, connect the intended Alertmanager receiver and record a controlled firing and resolution. No receiver delivery or deployed configuration is implied by local tests.

References: [alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/), [rule tests](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/).
