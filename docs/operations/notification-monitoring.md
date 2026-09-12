# Notification delivery monitoring

`EmailProviderDegraded` alerts when a provider's persisted health is zero. Replica series are combined per provider; a healthy sample from one replica cannot hide a degraded sample from another. The alert clears when the provider recovers. Local Prometheus rule tests cover healthy, tripped, replica disagreement and recovery states. Alertmanager routing and delivery to operations still require deployment evidence.

Migration0130 adds bounded failure timestamps. Drain older API and email-sending worker instances, apply the migration, then start the updated fleet together. Older writers do not maintain these timestamps. Legacy counters retain their earliest recorded window time conservatively; individual historical failure times cannot be reconstructed. Exact rolling evidence accumulates after rollout. Existing degraded states and probe ownership are preserved.

The circuit counts five consecutive transient provider failures inside a rolling five-minute window. Permanent provider rejections interrupt that sequence. Local ownership/persistence failures do not degrade the provider, and accepted delivery remains a provider success even when saving its receipt subsequently fails. This classification changes provider health only; ambiguous delivery outcomes still require reconciliation before any resend. A failed recovery probe keeps the circuit open, including a permanent failure. One new probe is permitted after the 60-second cooldown.

The worker exposes delivery metrics on its private `/metrics` endpoint. Import `deploy/monitoring/grafana-notifications-dashboard.json` and load `deploy/monitoring/notification-alerts.yml` in the monitoring stack's `rule_files`. The application repository does not own that stack's deployment or Alertmanager receivers.

Select the intended Prometheus instance in the dashboard's **Prometheus** data-source selector. Its failure-ratio panel uses fractional values: warning at 0.10 and critical at 0.25, displayed as 10% and 25%. The open-dead-letter panel retains count thresholds. This follows Grafana's [data-source variable](https://grafana.com/docs/grafana/latest/visualizations/dashboards/variables/add-template-variables/) and [threshold](https://grafana.com/docs/grafana/latest/panels-visualizations/configure-thresholds/) configuration. A September12 local check imported the unchanged dashboard into Grafana11.2.0 with Prometheus3.5.0 and synthetic samples. All five queries returned data; Chromium rendered the selected data source,90s age,12 queued,3 dead letters and an orange12.5% failure ratio. This verifies local dashboard compatibility, not deployed worker scrapes or alert delivery. See the [review screenshot](../../audit/evidence/r02-outbox-delivery/grafana-dashboard.png).

The rules use the maximum open dead-letter count across worker replicas, rather than summing copies of the same database count. They remove only `instance` and `pod` labels. Keep identical remaining labels for replicas of one database and distinct environment/database labels for separate deployments.

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
