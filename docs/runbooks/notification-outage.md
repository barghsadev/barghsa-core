# Notification delivery outage

**Incident P1 for confirmed delivery loss on a major customer path, or P2 for a contained degradation. Operations owns recovery.** A provider circuit opens, the worker stops scraping, or delivery failures and queue age rise. Authentication, receipts or status updates may be delayed.

1. Check provider status, worker readiness and firing receipt in the private operations receiver. Read the affected channel and scope in `/admin/failed-notifications`. Preserve stable occurrence keys, attempt state and accepted receipts.
2. Correct provider transport, account permissions or worker availability. A configuration pause requires a tested replacement provider version and its authorized activation. Confirmed provider acceptance remains authoritative if local receipt persistence failed.
3. Reconcile ambiguous sends against provider evidence. Retry an eligible item only after the reason is corrected, with current authorization and the existing audited controls. Use an explicitly authorized recipient for a controlled external test.
4. Verify a firing and recovery receipt, an actual accepted delivery for the affected channel and a shrinking eligible backlog. If authentication delivery was affected, verify a fresh OTP on an explicitly authorized test contact through the native flow. Use private in-app notices for eligible business updates while transport recovers. Keep OTP codes on the verified-contact path. Check that accepted occurrence keys were not resent and keep channel-disabled skips separate from provider receipts.

Escalate to the primary and vendor owner if a critical notification path remains unavailable or an outcome cannot be reconciled. Attach the masked occurrence, rule and recovery receipts and record follow-up actions. [Monitoring](../operations/notification-monitoring.md). [Delivery reconciliation](../operations/notification-delivery-recovery.md).
