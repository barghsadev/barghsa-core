# SMS.ir credit monitoring

Canonical scope: `05-notifications-documents-ai.md#T-05.07.04` and the low-credit alert criterion of `05-notifications-documents-ai.md#T-05.08`.

The worker checks the active SMS.ir account when credit is due, at least every six hours. A successful send brings a stale check forward, capped to once per 15 minutes; the send receipt itself has no credit value in the current adapter contract. A database lease prevents duplicate checks across worker replicas. A failed check retains the last known balance and retries after 15 minutes without logging credentials or raw provider responses.

Balance, check time, and low-credit state are durable. Crossing below the configured threshold creates one low-credit operational event; repeated low readings do not duplicate it. A later reading at or above the threshold creates one recovery event. Staff see the latest balance, low-credit warning, and event history in English and Persian. A threshold of zero disables the low-credit alert.

Validation: real PostgreSQL tests cover concurrent claims, low/repeated-low/recovery transitions, and provider failure retry; API provider tests and localized browser checks pass. Workspace build, typecheck, lint, snapshot consistency, formatting, and backlog checks pass.
