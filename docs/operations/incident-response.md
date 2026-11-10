# Incident response

An alert priority selects the first response. The operator who confirms impact assigns an incident severity under this plan. Record both as separately labeled fields in the incident. An alert P1 always pages the primary and can become an incident P0 or P1 as impact is confirmed. [Alert priorities](service-objectives.md#alert-priorities).

| Incident severity | Impact                                                                                                                                                          | Response                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P0                | Core service unavailable, suspected unauthorized payment or refund movement, confirmed ledger integrity failure, or active security breach.                     | Page the primary on-call operator and call by phone. Acknowledge in under 15 minutes. Escalate to the secondary if the primary is unreachable. |
| P1                | A major feature is unavailable or materially degraded, with core service still available and no indication of unauthorized financial movement or active breach. | Page the responsible service owner and notify the primary on-call operator. Acknowledge in under one hour.                                     |
| P2                | Minor non-critical defect or isolated degradation with a safe workaround.                                                                                       | Assign the responsible team and respond by the next working day.                                                                               |
| P3                | Cosmetic defect or routine maintenance without customer impact.                                                                                                 | Add it to the team's backlog for working-hours review.                                                                                         |

## Coverage and channels

- Operations publishes a primary and secondary rotation in its protected roster. Each handoff confirms reachability, ownership, access and open incidents. The primary coordinates triage and assigns a service owner and a person to record events. The secondary takes over if the primary cannot respond. Finance owns settlement and reconciliation decisions, security owns evidence and credential response, and operations owns traffic and recovery changes.
- Send incident alerts to the approved private operations Slack or Telegram channel. Page and call the protected on-call contact for P0. During an alert-channel outage, use the verified secondary and phone contacts. The production approval package records the roster, destination checks and dead-man receipt. [Staging notification receiver and evidence](notification-monitoring.md).
- Give support a sanitized incident reference, impact and next update time. Use customer communications only after the responsible incident owner approves them through the established channel. The release channel remains reserved for release notices.

## Response

1. Open a protected incident record. Capture UTC start and detection times, environment, affected journeys, current image/configuration identity, correlation IDs, incident severity, owner and next update time. Collect sanitized monitoring and audit references.
2. Contain the affected capability using its documented controls and required authorization. Preserve customer access to unaffected capabilities. For financial incidents, hold further affected writes or attempts and preserve immutable ledger, obligation and provider records. Reconcile unknown provider outcomes before any retry. [Delivery reconciliation](notification-delivery-recovery.md).
3. Apply the relevant recovery procedure. Start destructive or data-changing recovery with a verified isolated rehearsal and the required approvals. Preserve the failed instance or evidence as applicable. Confirm service health, worker readiness, an affected customer journey and any financial reconciliation before restoring normal traffic. [Deployment verification](../../deploy/production/README.md). [Database recovery](backup/postgresql-restore-runbook.md). [Storage verification](storage-configuration.md).
4. Record containment and recovery times, verified impact and all residual risks. Reopen if the symptoms or unexplained differences recur. Within five working days, create a follow-up issue in the approved operations Jira project and record the timeline, root cause, safeguards that worked, actions, owners and dates. Keep sensitive attachments in protected evidence storage and link their references.

## Recovery procedures

- Finance and payments. [Payment or wallet mismatch](../runbooks/payment-wallet-mismatch.md). [Refund backlog](../runbooks/refund-backlog.md).
- Data and storage. [PostgreSQL failover](../runbooks/database-failover.md). [PostgreSQL restore](../runbooks/database-restore.md). [Object storage outage](../runbooks/storage-outage.md).
- Platform and providers. [Bad deployment and rollback](../runbooks/bad-deployment.md). [Redis loss](../runbooks/redis-loss.md). [Notification outage](../runbooks/notification-outage.md). [AI provider outage](../runbooks/ai-provider-outage.md).
- Security. [Security incident runbook](../runbooks/security-incident.md). [Credential compromise](../runbooks/credential-compromise.md).

## Quarterly runbook review

Operations leads the review in the first working week of each calendar quarter, with Finance, Security and the database operator reviewing their procedures. Check the severity, owner, escalation contact, steps and recovery checks against the current environment. Open each alert's `runbook_url` with an operator account and confirm that it leads to the procedure for that signal. Record the review and any follow-up in the existing operations issue tracker. [Application alert rules](../../deploy/monitoring/notification-alerts.yml). [Staging worker alert rule](../../deploy/monitoring/staging-worker-alerts.yml). [Prometheus alert annotations](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/#defining-alerting-rules).

The repository review on November 10, 2026 checked the payment, refund, database, storage, notification, credential, deployment and AI procedures against the current rule definitions. The next review is due in the first working week of January 2027.

## Security incidents

Restrict evidence access to the incident team. Record who collected each artifact and when. Preserve scoped audit events, sanitized logs, build and configuration identities, and the hashes of preserved artifacts. Keep credentials and customer data in protected storage. Coordinate isolation with security so evidence collection cannot prolong active compromise.

Revoke compromised sessions, tokens or keys through the existing authority. Rotate provider credentials through the protected configuration lifecycle, verify the replacement, and retire the affected version. Keep already-accepted receipts and reconcile uncertain operations before replaying them. Verify denial of the old credential, success of the authorized replacement and fresh session authority. [Session controls](../security/session-lifetime.md). [Account recovery](../runbooks/account-recovery.md).

Use these drafts after scope and affected recipients are verified and the incident owner approves publication. Share confirmed facts, any action the recipient should take and the next update time.

> We identified an issue affecting [service or action] starting at [time]. We have taken [confirmed containment action]. [Action the recipient should take, if applicable.] We will provide the next update by [time] through [official channel]. Reference [incident reference].

> مشکلی را شناسایی کرده‌ایم که از [زمان] بر [سرویس یا اقدام] اثر گذاشته است. [اقدام تأییدشده برای مهار مشکل] را انجام داده‌ایم. [اقدام لازم برای شما، در صورت نیاز.] اطلاع‌رسانی بعدی تا [زمان] از طریق [کانال رسمی] انجام می‌شود. شناسه پیگیری [شناسه رخداد].
