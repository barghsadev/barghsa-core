# Staff profile archival

Staff use the profile's Archive action after reviewing its confirmation checklist and entering a reason. The server checks current `admin:users:edit` permission and recent password verification. Prefer resolving or suspending a profile when its business obligations remain open.

The archive operation refuses active orders, contracts detected by the contract guard, unpaid invoices, nonzero posted or reserved wallet balances, pending wallet transactions and open identity corrections. A legal profile's canonical owner is `profiles.user_id`; agent memberships cannot replace that ownership. The current legal profile cannot be archived while its canonical ownership remains active.

Successful archival sets `archived`, `archived_at` and `archived_reason`. It preserves the profile and its business records. The same database transaction records `profile_deleted` with the staff actor, profile, reason, owner, timestamp and correlation ID. Staff can read the retained profile through CRM. Archiving one profile does not close its user account, end its sessions or archive sibling profiles.

## Verify a completed archive

1. Confirm that the response names the requested profile and includes its archival timestamp. A missing or invalid acknowledgement is not proof of completion.
2. Reload that profile in CRM and check its archived status, reason and time. If the response was interrupted, inspect the saved state before retrying. An already-archived response does not create another archival audit event.
3. Check the matching `profile_deleted` audit record when investigating an incident. Preserve the original reason and history.

## Retention handoff

The owner approved soft archival as the launch scope on 9 October 2026. This is not approval for physical disposal or a claim of retention compliance. Financial and contractual document bytes remain permanent. See [fulfillment and financial closure decisions](../decisions/fulfillment-and-financial-closure.md).

This endpoint performs no physical deletion and schedules no purge. Retention duration, holds, approvals and eventual disposal procedures are not configured by this task. Keep records intact until the organization has an approved policy for the affected record classes and an authorized disposal process. The audit's existing retention note is a reminder, not evidence that a retention period or legal basis has been approved.

Before any future disposal feature is built or operated, its owner must supply the applicable policy, hold rules, authorization and evidence requirements, including retained backups and linked business records. Record that operational approval separately from local software tests. No production retention or deletion exercise has been performed by this repair.

Production contracts and their creation writers are implemented. Staff contract authoring and solar contract issuance acquire the profile lock before contract writes; electricity and saving submissions use the same profile row through order authorization. These locks conflict with archival's exclusive profile lock, and writers reject an archived profile after waiting. A committed contract makes archival refuse the operation.

The existing archival guard conservatively blocks every retained contract, including terminal history. Closing a contract does not authorize profile archival or disposal. The retention handoff above remains required before any future relaxation of that guard.
