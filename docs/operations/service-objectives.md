# Service objectives and alert priorities

The [architecture reliability targets](../../architecture.md#reliability-targets) apply to core authenticated flows. Evaluate each objective for the intended environment and service. Keep the four launch journeys visible separately so that a busy service cannot hide a failing one.

| Objective                  | Indicator                                                                                                                                                                                                                                                                                                      | Target                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Monthly availability       | Successful eligible authenticated journey attempts divided by all eligible attempts. Count service errors, timeouts and failed critical dependencies as failures. Use representative external probes for traffic gaps and report missing probe data separately.                                                | 99.5% pilot without an HA commitment, 99.9% commercial HA                    |
| API latency                | p95 elapsed request time by ordinary route and operation. Exclude measured third-party processing time from the write budget and report end-to-end latency alongside it. Keep timeouts visible in availability.                                                                                                | Reads under 300 ms, writes under 500 ms                                      |
| Core page experience       | p75 Largest Contentful Paint for core routes on a representative mobile connection. Track field measurements and browser lab checks separately.                                                                                                                                                                | Under 2.5 seconds                                                            |
| Durable job start          | p99 time from a committed job becoming eligible to its first valid worker claim. Scheduled jobs become eligible at their due time. Report by queue, including notification and dedicated document/AI queues. Count jobs still unclaimed at 60 seconds as misses in the objective and track retries separately. | At least 99% start within 60 seconds, with priority for urgent/refund queues |
| PostgreSQL recovery point  | Gap between the latest committed source record before the incident and the latest verified restored record. Report unknown if source or restored state cannot be verified.                                                                                                                                     | At most 5 minutes                                                            |
| Core service recovery time | Time from service loss through verified core readiness, worker recovery and readback of committed financial records. Measure isolated rehearsals from the start of recovery and label the result as rehearsal evidence.                                                                                        | At most 60 minutes                                                           |

Exclude rejected invalid input and expected authorization denials from availability. Count a denial of an authorized critical action caused by a service failure as a failure. Report raw request, journey and job counts with the indicators. Keep unobserved periods visible.

## Executive SLO dashboard

Select the environment, database and applicable availability target in private Grafana. The dashboard opens at the start of the current UTC month. The availability and remaining budget panels use the selected period and display electricity, saving, solar and consultation separately. Burn rate compares five-minute and one-hour failure ratios with the selected tier's allowed failure fraction. A burn rate of 1 uses the budget at the allowed pace. The latency panel uses completed API responses by method.

Check the observed attempt counts against the journey collector's coverage before interpreting availability. Verify that both initialized outcomes for all four services appear in the scrape. A service without measured attempts has no availability or burn value. When comparing releases, select comparable periods before and after the verified deployment time and retain the guarded rollout receipt with the dashboard comparison. [Executive SLO dashboard](../../deploy/monitoring/grafana-executive-slo-dashboard.json) · [Rollout observation setup](../../deploy/production/README.md#configure-the-observation-hook).

The API collects both outcomes for each service on an allowlist of customer intake and progress routes. These cover previews or reviews, submissions, lists and details, and the named correction and decision routes. A request needs a validated customer session and a matched route. Completed success responses and cache validation count as success. Server errors, HTTP request timeouts and interrupted responses after authentication count as failures. Expected 4xx rejections are excluded. Authentication failures before a customer session is established, browser and edge failures, shared wallet or contract operations and asynchronous fulfillment need their own evidence. [Measured route list](../../apps/api/src/metrics/http-request-metrics.ts) · [Independent synthetic checks](../../deploy/production/README.md#synthetic-health-probes).

### Journey burn alerts

Give the protected collector target one `availability_tier` label per environment and database. Use `pilot` for the 99.5% objective or `commercial` for 99.9%. The rules compare the failure fraction with that tier's budget for each service. They require both outcome series and measured attempts. Check collector health separately when those measurements are missing.

The P1 rule requires 5% of the current UTC month's budget per hour over both the one-hour and five-minute windows. The P2 rule requires 2% per day over both the 24-hour and two-hour windows. A firing P1 suppresses the P2 for the same service and scope. The private inbox preserves the alert priority and the affected service. Verify collector ingestion, firing and resolved receipts, and approved pager and team routing in the target environment. [Prometheus rules](../../deploy/monitoring/journey-slo-alerts.yml) · [Journey runbook](../runbooks/journey-availability.md) · [Multi-window alerting](https://sre.google/workbook/alerting-on-slos/).

## API health dashboard

Import the API Health dashboard into private Grafana and select the Prometheus
data source that scrapes the API. Label each scrape target with its environment
and database and keep each API replica as a distinct target. The response panels
use five-minute rates by method, route template and HTTP status. Error ratios
and latency percentiles show a gap during idle periods. Compare these completed
response measurements with the separate synthetic journey availability checks
to account for timeouts and failed connections.

The release panel counts API replicas by the immutable source revision observed
at each scrape. Compare it with request and error trends during rollout or
rollback. Several revisions can appear during a rolling update. Use deployment
receipts for exact deployment timestamps. [API Health dashboard](../../deploy/monitoring/grafana-api-health-dashboard.json).

## Latency budgets for release rehearsal

Use these starting budgets per route and query class. The existing 300 ms
read and 500 ms write p95 targets apply to every ordinary core route.

| Operation                                      |    p50 |          p95 |      p99 |
| ---------------------------------------------- | -----: | -----------: | -------: |
| API reads, including lists and detail          | 125 ms | under 300 ms |   750 ms |
| API writes, including reviewed money mutations | 200 ms | under 500 ms | 1,250 ms |
| Profile-scoped SQL reads and bounded lists     |  25 ms |       100 ms |   200 ms |
| SQL statements in a core write transaction     |  40 ms |       125 ms |   200 ms |

Time the API request through completion and keep end-to-end latency visible.
For a write with a third-party call, exclude provider time from the write
budget only when the same attempt measures it separately. Record queue time
and lock waits as part of the appropriate request or query measurement. For
SQL, group by a stable operation label or a private PostgreSQL query ID. Use
elapsed statement samples for percentiles. Report connection acquisition
separately, and use the existing 200 ms slow-query warning to investigate
the tail. [PostgreSQL monitoring](postgresql-monitoring.md)

Measure electricity previews and submissions, wallet payments, customer
invoice lists, staff CRM search, authorized upload reservation and
notification enqueue separately. Separate provider work and worker queue
start from API enqueue latency. Use representative Persian and English
fixtures, realistic index cardinality and synthetic funds. Record the
candidate, dataset size, concurrency, warm-up interval, sample counts,
failures and timeouts. Keep p99 unverified for any operation with fewer than
1,000 completed samples and report unsuccessful attempts separately.

The weekly load workflow runs Sundays at 03:00 UTC and supports a manual run
on a candidate ref. It builds the compiled API, applies production migrations
to disposable PostgreSQL and uses 1,000 synthetic customer accounts, 5,000
background profiles and eight concurrent k6 users. Each iteration uses a
distinct customer and writes new orders, payments and upload reservations.
The fixture passes up to 50 synthetic client addresses through its trusted
loopback hop. The existing invoice-list quota remains active for each address.
The protected loopback operations receiver enqueues private inbox delivery for
three synthetic staff recipients. The upload path measures authorization and signing.
It issues no object upload. Provider delivery is outside this workload.

The artifact names the source commit, fixture size, sample counts and p50,
p95 and p99 for each path. It records the strict read and write budgets and
fails the weekly regression check at 360 ms and 600 ms p95, respectively,
or when any required operation fails or misses its sample count. The report
marks any miss of the underlying 300 ms or 500 ms rehearsal target separately.
The fixture verifies the final order, paid invoice, wallet debit, reservation
and notification receipt counts when all requests complete, including when
the latency gate fails. An isolated run establishes a regression
baseline. Production-topology load and recovery require separate evidence.

For a local smoke run, install k6 v2.3.0 and run the dedicated Vitest
configuration with `BARGHSA_PERFORMANCE_SMOKE=1`,
`BARGHSA_PERFORMANCE_SHA=$(git rev-parse HEAD)` and a local disposable Docker
runtime. Set `BARGHSA_PERFORMANCE_REPORT` to retain the JSON artifact. Smoke
mode uses four samples and leaves p99 unavailable.

## Alert priorities

| Priority | When to use                                                                                                                                                                                                                         | Required response                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| P1       | A core service is unavailable to customers, a critical availability budget is burning fast, or payment/refund integrity is at risk. Suspected duplicate charges and wallet-to-ledger mismatches above the safety threshold qualify. | Page the on-call operator immediately. Open an incident, assign an owner and use the affected service's recovery runbook.  |
| P2       | A service or dependency is degraded, a durable queue is beyond its target, a refund is overdue, or SMS credit falls below the configured threshold.                                                                                 | Notify the owning team and open a time-bounded task. Reassess priority if the customer impact or financial risk increases. |
| P3       | A routine warning or informational condition calls for maintenance. Examples include early certificate renewal reminders or a storage lifecycle warning with no active data loss.                                                   | Add it to the operations review queue for working-hours triage.                                                            |

The notification rules' `severity` label controls Alertmanager behavior such as inhibiting the dead-letter warning during accumulation. Use alert priority to select the first response, then classify the confirmed incident using the incident response plan. `SmsProviderLowCredit` carries `priority: P2` in the deployed rule under the specific notification requirement. A confirmed financial integrity mismatch uses alert P1 even when it is first observed during routine reconciliation. [Notification rules and response](notification-monitoring.md). [Incident response plan](incident-response.md).

Record the affected environment and service, owner, scope, detection time, dashboard and runbook with each incident. The SLO dashboard, burn-rate rules, pager/team/review routing and dead-man check each require their own deployment and readback evidence. [PostgreSQL recovery verification](backup/postgresql-restore-runbook.md).
