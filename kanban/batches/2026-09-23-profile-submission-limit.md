# Profile submission protection — September 23, 2026

Canonical task: `03-core-business.md#T-03.90.05`.

Electricity, saving, solar, and consultation submissions now share one rolling cap of five committed submissions per profile per minute. The check runs after profile authorization and idempotency lookup, inside the submission transaction. A profile-scoped advisory lock serializes concurrent submissions by different legal agents; a replay of an existing submission key still returns its original result at the cap. The authenticated route guards retain a broader per-user abuse limit.

Validation: four related API HTTP integration suites passed (33 tests), including mixed solar/consultation submissions, a two-agent concurrency race, replay at the cap, and a separate profile under the same user. API typecheck, targeted lint and formatting, OpenAPI contract, backlog validation, and diff checks passed. No schema change was required. CI for this batch is pending after the direct `main` push.
