# Notification delivery identity migration

Migration `0092_notification_delivery_identity` belongs to F09/F10. It adds the missing channel-job provider reference, versions provider keys, and gives inbox inserts a unique occurrence identity.

Before deploying this migration, drain and stop every old notification worker. Deploy the new worker before restarting consumption. An old worker cannot honor the new identity version or inbox deduplication column. This document does not authorize operating the scheduler or workers on the other machine.

New outbox occurrences use version 2 keys derived from the outbox ID, channel, and profile. Existing unattempted rows without delivery evidence can adopt version 2. Attempted rows retain version 1 provider keys. Existing successful inbox deliveries are linked only through matching delivery-log/job provider references, profile, and event type. Existing duplicate historical inbox rows and their read states are retained.

If a legacy attempted row has no provable inbox insertion, the migration sets its outbox state to `failed` with `legacy_delivery_requires_reconciliation`. This is a recovery hold, not a claim that the original business task failed or that no delivery occurred. No product event or completion entry is deleted.

Read-only inspection after migration:

```sql
SELECT id, profile_id, event_key, attempts, status, idempotency_version,
       last_error, created_at
FROM notification_outbox
WHERE last_error = 'legacy_delivery_requires_reconciliation'
ORDER BY created_at, id;

SELECT o.id, j.channel, j.status, j.attempts, j.provider_ref,
       l.status AS recorded_outcome, l.provider_ref AS recorded_reference,
       l.created_at AS recorded_at
FROM notification_outbox o
LEFT JOIN notification_job j ON j.outbox_id = o.id
LEFT JOIN notification_delivery_log l
  ON l.notification_id = o.id AND l.channel = j.channel
WHERE o.last_error = 'legacy_delivery_requires_reconciliation'
ORDER BY o.id, j.channel, l.created_at;
```

Do not bulk-reset held rows. Reconcile each against the inbox and available provider evidence. A proven existing inbox item must be linked to `outbox:<outbox UUID>` without changing its content or read state. Only a proven undelivered occurrence may be retried. Record the evidence and resulting state change in the audit before releasing a hold. Text/payload resemblance alone is insufficient proof. Provider-specific ambiguous outcomes may require provider records.

This migration does not itself solve recipient quiet hours, per-channel retry scheduling, SMTP exactly-once delivery, or real business-event email/SMS transport registration. Those remain subsequent repair checkpoints.
