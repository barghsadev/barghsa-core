# Object storage outage

**Incident P1 for blocked uploads or downloads, with P0 escalation for suspected loss or exposure of protected records. Operations owns recovery with Legal for retained records.** Suspect storage when signed transfers fail, verified objects cannot be read, or document scanning cannot reach the active bucket.

1. Scope the failure to private server access, the browser signed endpoint, permissions, encryption or the provider. Record the active configuration version and masked evidence. Keep the original bucket, object keys and version IDs available for recovery.
2. Open `/admin/storage` and verify the active endpoint and version with the authorized operator. Check TLS, network policy, bucket versioning, object-lock rules and browser CORS at the appropriate boundary. Run the existing staged upload and signed readback with disposable fixture bytes. Preserve active object-location and credential safeguards.
3. Hold affected writes and continue authorized metadata or read-only work where available. Correct the original service or activate a tested credential replacement using the audited admin path. A region change for referenced objects requires an approved migration that verifies every required version, checksum, object key and legal hold before cutover. Retain the source until recovery is verified.
4. Recover missing data from the provider's verified version history or backup. Identify the recorded key and version, check bytes and checksum in isolation and preserve signed-record references and holds through the approved recovery procedure. Verify byte agreement on the disposable fixture, successful authorized browser transfer and refusal for a foreign profile. Read back versioning and retention settings. Resume only eligible retries after the affected records are verified.

Escalate to the provider and Legal if any signed or retained object version is unavailable. Preserve provider receipts and failed operation evidence for the review. [Storage configuration](../operations/storage-configuration.md). [Retention safeguards](../operations/storage-retention.md). [Incident response](../operations/incident-response.md).

## Working-hours lifecycle review

`StorageLifecycleNeedsReview` fires after five minutes with an unresolved storage cleanup, abandoned multipart upload cleanup or document destruction failure. Use the Storage and Uploads dashboard to identify the affected job and open `/admin/failed-jobs` for its durable failure and retry state. Verify the expected provider result and the recorded object operation before closing the review. Use the audited retry flow and retain pending holds, signed originals, and uncertain results. Escalate blocked customer transfers or suspected loss through the incident procedure above.

## Quarterly recovery checks

The [recovery workflow](../../.github/workflows/storage-recovery-quarterly.yml) runs at 04:17 UTC on January 1, April 1, July 1 and October 1. It reads a specific retained version after logical deletion, checks version-specific hold and expiry behavior, and exercises orphaned and interrupted multipart uploads in disposable MinIO and migrated PostgreSQL. The [quarterly manual exercise](../operations/quarterly-recovery-exercise.md) includes the same storage checks. Retain the two storage reports with their Actions run and commit in the release board.

For the disaster-recovery exercise, use the approved off-server storage and an isolated destination. Retrieve a retained fixture by its recorded key and version ID, compare the recovered checksum and size, and verify the expected hold and expiry policy in the destination. Inspect orphan and cleanup records with the storage operator and retain unresolved items for review. Record the source and recovery identities, measured recovery times and the affected service journey with the [database recovery evidence](../operations/backup/postgresql-restore-runbook.md). The CI checks use synthetic data and credentials.
