# Notification delivery monitoring

The worker exposes delivery metrics on its private `/metrics` endpoint. Import `deploy/monitoring/grafana-notifications-dashboard.json` and load `deploy/monitoring/notification-alerts.yml` in the monitoring stack's `rule_files`. The application repository does not own that stack's deployment or Alertmanager receivers.

Select the intended Prometheus instance in the dashboard's **Prometheus** data-source selector. Its failure-ratio panel uses fractional values: warning at 0.10 and critical at 0.25, displayed as 10% and 25%. The open-dead-letter panel retains count thresholds. This follows Grafana's [data-source variable](https://grafana.com/docs/grafana/latest/visualizations/dashboards/variables/add-template-variables/) and [threshold](https://grafana.com/docs/grafana/latest/panels-visualizations/configure-thresholds/) configuration. Dashboard import, actual query results and rendering still need verification; parsing the JSON alone does not prove them.

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
