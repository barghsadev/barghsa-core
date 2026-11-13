# Bad deployment and rollback

**Incident P1 for a failed rollout with traffic still served, or P0 for core unavailability or financial integrity risk. Platform operations leads with the owners listed below.** Signals include failed readiness or smoke, elevated error budget burn, reconciliation mismatch or a security alert.

## Application rollback

1. Halt the rollout and remove the affected canary or replicas from traffic. Record the candidate and previous image digests, applied migrations and failed checks. In staging, read Compose status and the active manifest to see whether automatic restoration succeeded.
2. The release operator restores the last verified compatible app and web image digests through the deployment tooling. Verify API, worker, inference and web image readback. Keep additive forward-compatible migrations in place. If the schema is incompatible, use a tested roll-forward or the separately authorized migration recovery plan. A reverse migration must be explicitly tested against the current data and shown to preserve accepted writes.
3. Check `GET /api/health/live`, `GET /api/health/ready`, worker readiness, the affected journey, reconciliation and the post-rollback error baseline before returning traffic. [Staging image restoration](../../deploy/staging/README.md). [Production image verification](../../deploy/production/README.md).

Automatic staging rollback uses the app and web image IDs recorded in the active
manifest. It checks the old app against the current schema, then verifies the
running image IDs of the API, worker, AI inference and web services. If a recorded
image is unavailable or the restored services fail verification, the runner
stops the application services and reports the failed restoration.

If the old image fails schema verification, keep writers stopped. Record the
exact image digests, migration journal, active database identity and the last
known healthy state. The database operator verifies a roll-forward or
rehearses the matching backup on a separate target. Finance and the affected
service owner reconcile transactions accepted since that recovery point.
Resume writers after the authorized recovery, current schema check,
readiness and reconciliation pass.

For a guarded rollout, read the last event in the protected JSONL receipt.
`rolled_back` records verified restoration to the previous pool.
`rollback_unverified` or an interrupted receipt requires current ingress
and image readback before retrying. Keep the observation and halt reason with
the deployment record. [Guarded rollout](../../deploy/production/README.md#guarded-traffic-rollout).

## Configuration rollback

1. The authorized configuration owner identifies the last safe version and why it remains safe with current data and application versions. Preserve the current version, audit trail and active object location. Keep compromised credentials retired.
2. Use the supported versioned admin flow to apply the captured safe settings as an audited active version, with fresh authority and validation. Providers require the configuration-bound tests and explicit activation.
3. Read back the effective version and exercise the affected behavior. Confirm the rejected version remains in the audit and stale updates are refused. [Storage configuration](../operations/storage-configuration.md). [Provider activation and recovery](../operations/notification-monitoring.md).

For a capability pause, open **Service maintenance**, select the service, and
open **Maintenance history**. Restore a published revision as a draft. This
keeps the current status in effect. Review the draft and replace an expired
return time before activating it. Historical private rationale stays in its
original audit event. Enter a new private rationale when the standard notice
is selected. If draft creation is unconfirmed, reload the history and load the
stored draft. If another change became active, select a revision against the
new current version. Verify the new active version and its source in the audit.

For green-electricity rules, open **Green rules history** on the electricity
settings page. Select a published revision to prepare a recovery draft. Review
both order modes before selecting **Activate recovery draft**. Activation checks
the current green product and quantity limits and records a new version linked
to the draft and source revision. After a timeout, reload history and check the
active rules before repeating any command.

For contract electricity limits, open **Contract limits history** on the
contract limits page. Prepare a draft from a prior revision, review the three
limits and confirm **Activate recovery draft**. Activation records a new
version linked to its draft and source. The current increase cap is checked
when staff approve a pending request. If another save intervenes, refresh
history and prepare a draft against the current revision.

For a security rate limit, choose the action on the verification settings page
and open **Rate-limit history**. Prepare a draft from a previously saved regular
limit. Review the draft and confirm **Activate recovery draft**. Activation
creates a new version, keeps the current emergency rule and preserves existing
request counters. Refresh the settings if another operator changes the action
before activation.

## Data rollback

1. Treat suspected data loss as P0. The database operator preserves the source and restores to a separate target using the approved backup and, when needed, the PITR target.
2. Finance and the affected service owner verify lost or retained transactions against independent evidence. Fence source writes before an approved cutover.
3. Confirm restored data, measured recovery point/time and authenticated service readiness. A failed schema migration alone does not authorize overwriting the live database. [Database restore](database-restore.md).

## Feature rollback

1. The authorized feature owner disables the affected capability using its documented flag or maintenance control. Keep unaffected routes and required provider reconciliation paths available.
2. Verify current persisted flag state and the server's enforcement, including no new side effects for disabled operations. Check existing obligations and unrelated workflows before reopening.
3. Re-enable only after the approved fix and affected journey checks pass. [AI chat maintenance example](../operations/ai-inference.md).

Call the primary, service owner and Finance or security when the rollback cannot restore verified state. Preserve the failed and restored versions, exact verification receipts and recovery decision in the incident report. Conduct a blameless review of the timeline, contributing conditions and corrective actions. [Incident response](../operations/incident-response.md).
