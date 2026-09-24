# Provider delivery metrics

Canonical scope: `05-notifications-documents-ai.md#T-05.08.03` (one-hour delivery metrics and queue visibility).

Every new email/SMS delivery attempt retains its provider ID in the append-only delivery history. This allows staff metrics to stay attributed to the provider that actually sent the attempt after configurations rotate. Existing history has no provider ID and is intentionally excluded rather than guessed from the latest receipt.

The provider lists now show attempts, failure rate, average latency, p50/p95/p99 latency, and the current channel queue depth and oldest queued time in Persian and English. The queue belongs to a channel, so it is displayed only on its active provider. An unknown delivery outcome counts as a failed attempt; a still-sending attempt is excluded from the outcome rate. The one-hour window uses attempt creation time.

Validation: PostgreSQL integration checks for metrics attribution and durable receipt history, provider UI browser checks in both languages, snapshot consistency, workspace typecheck, lint, and focused API/web tests. The prior CI run's unrelated English maintenance-message mismatch was corrected and its exception-filter suite passes. Provider alert history remains outstanding in T-05.08.03.
