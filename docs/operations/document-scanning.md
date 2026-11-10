# Document scanning

The API seals an uploaded document into its immutable private storage copy before
making a scan job. When `DOCUMENT_CLAMAV_HOST` is configured, confirmation leaves
the document in `PendingScan`; customer downloads and previews remain blocked.
The worker streams that sealed copy to ClamAV using INSTREAM, up to the 100 MiB
upload-policy ceiling. It checks the full streamed size and SHA-256 against the
sealed record before committing a verdict. A clean verdict makes the document
`Available` and atomically supersedes an older version. A malware verdict makes
it `Quarantined`, blocks customer access, and alerts active admins.

The 100 MiB ceiling applies to video uploads. The other categories keep their
smaller deployment limits. The browser, reservation and record endpoints all
use the effective policy, including lower active admin limits.

Set `DOCUMENT_CLAMAV_HOST` on **both** API and worker to the same restricted,
reachable clamd service. `DOCUMENT_CLAMAV_PORT` defaults to `3310` on the worker.
Apply migration `0205_document_scanning` before enabling the setting. Do not
expose clamd's TCP port publicly; it has no authentication. Keep the API and
worker configuration aligned so confirmed documents have a running consumer.
Configure clamd's stream size limit to at least 100 MiB, matching the largest
allowed upload. A scanner with a smaller limit leaves larger documents pending.

The production Compose overlay builds the official ClamAV 1.5 Debian image
with a 100 MiB stream limit and `AlertExceedsMax` enabled. It keeps signature
updates in the `clamav-db` volume, publishes no scanner port to the host, and
starts the API and worker only after ClamAV is healthy. The overlay sets
`DOCUMENT_CLAMAV_HOST=clamav` for both services. Deploy the database migration
before starting the updated stack. Allow for a longer first startup while
ClamAV loads and updates its signatures.

Scanner, storage, or checksum failures leave the document in `PendingScan` and
retry with exponential backoff (30 seconds up to one hour). The third failed
attempt sends one in-app alert to each active admin. Check `document_scan_jobs`
for `attempts`, `last_error`, and `next_attempt_at`, and the `document_scan`
background-job record for poller health. Once the scanner or storage is restored,
the same job retries automatically. The customer sees only the safe “File not
accepted” state for quarantined documents; staff can inspect the audit trail.

With no scanner host configured, the existing upload policy marks confirmed
documents `Available` with `scan_skipped_reason=not_configured`.
