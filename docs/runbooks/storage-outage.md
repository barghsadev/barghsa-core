# Object storage outage

**Incident P1 for blocked uploads or downloads, with P0 escalation for suspected loss or exposure of protected records. Operations owns recovery with Legal for retained records.** Suspect storage when signed transfers fail, verified objects cannot be read, or document scanning cannot reach the active bucket.

1. Scope the failure to private server access, the browser signed endpoint, permissions, encryption or the provider. Record the active configuration version and masked evidence. Keep the original bucket, object keys and version IDs available for recovery.
2. Open `/admin/storage` and verify the active endpoint and version with the authorized operator. Check TLS, network policy, bucket versioning, object-lock rules and browser CORS at the appropriate boundary. Run the existing staged upload and signed readback with disposable fixture bytes. Preserve active object-location and credential safeguards.
3. Correct the original service or activate a tested credential replacement using the audited admin path. A move of referenced objects requires the dedicated migration plan and Legal review of retained objects. Resume retries only for eligible failed jobs and preserve original upload and scan evidence.
4. Verify byte and checksum agreement on the disposable fixture, successful authorized browser transfer and refusal for a foreign profile. Read back versioning and retention settings, and verify affected documents without exposing their bytes in logs.

Escalate to the provider and Legal if any signed or retained object version is unavailable. Preserve provider receipts and failed operation evidence for the review. [Storage configuration](../operations/storage-configuration.md). [Retention safeguards](../operations/storage-retention.md). [Incident response](../operations/incident-response.md).
