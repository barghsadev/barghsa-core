# Service objectives and incident priorities

The [architecture reliability targets](../../architecture.md#reliability-targets) apply to core authenticated flows. Evaluate each objective for the intended environment and service. Keep the four launch journeys visible separately so that a busy service cannot hide a failing one.

| Objective | Indicator | Target |
| --- | --- | --- |
| Monthly availability | Successful eligible authenticated journey attempts divided by all eligible attempts. Count service errors, timeouts and failed critical dependencies as failures. Use representative external probes for traffic gaps and report missing probe data separately. | 99.5% pilot without an HA commitment, 99.9% commercial HA |
| API latency | p95 elapsed request time by ordinary route and operation. Exclude measured third-party processing time from the write budget and report end-to-end latency alongside it. Keep timeouts visible in availability. | Reads under 300 ms, writes under 500 ms |
| Core page experience | p75 Largest Contentful Paint for core routes on a representative mobile connection. Track field measurements and browser lab checks separately. | Under 2.5 seconds |
| Durable job start | p99 time from a committed job becoming eligible to its first valid worker claim. Scheduled jobs become eligible at their due time. Report by queue, including notification and dedicated document/AI queues. Count jobs still unclaimed at 60 seconds as misses in the objective and track retries separately. | At least 99% start within 60 seconds, with priority for urgent/refund queues |
| PostgreSQL recovery point | Gap between the latest committed source record before the incident and the latest verified restored record. Report unknown if source or restored state cannot be verified. | At most 5 minutes |
| Core service recovery time | Time from service loss through verified core readiness, worker recovery and readback of committed financial records. Measure isolated rehearsals from the start of recovery and label the result as rehearsal evidence. | At most 60 minutes |

Exclude rejected invalid input and expected authorization denials from availability. Count a denial of an authorized critical action caused by a service failure as a failure. Report raw request, journey and job counts with the indicators. Keep unobserved periods visible.

## Incident priorities

| Priority | When to use | Required response |
| --- | --- | --- |
| P1 | A core service is unavailable to customers, a critical availability budget is burning fast, or payment/refund integrity is at risk. Suspected duplicate charges and wallet-to-ledger mismatches above the safety threshold qualify. | Page the on-call operator immediately. Open an incident, assign an owner and use the affected service's recovery runbook. |
| P2 | A service or dependency is degraded, a durable queue is beyond its target, a refund is overdue, or SMS credit falls below the configured threshold. | Notify the owning team and open a time-bounded task. Reassess priority if the customer impact or financial risk increases. |
| P3 | A routine warning or informational condition calls for maintenance. Examples include early certificate renewal reminders or a storage lifecycle warning with no active data loss. | Add it to the operations review queue for working-hours triage. |

The notification rules' `severity` label controls Alertmanager behavior such as inhibiting the dead-letter warning during accumulation. Use incident priority to select the response. `SmsProviderLowCredit` carries `priority: P2` in the deployed rule under the specific notification requirement. A confirmed financial integrity mismatch uses P1 even when it is first observed during routine reconciliation. [Notification rules and response](notification-monitoring.md).

Record the affected environment and service, owner, scope, detection time, dashboard and runbook with each incident. The SLO dashboard, burn-rate rules, pager/team/review routing and dead-man check each require their own deployment and readback evidence. [PostgreSQL recovery verification](backup/postgresql-restore-runbook.md).
