# Customer cancellation requests

Merged in PR [#329](https://github.com/barghsadev/barghsa-core/pull/329) at `f1d74a3d8a4962f542c2c2d80f44a0ffd7512c21`. Exact-head review approved `c85bb7d77f4db20af70b9d9db310c2fa88c37c8d`; all five checks passed in run35558485876. Merge and durable review were read back and verified. Local combined changed-source coverage passed for API, web, DB and i18n. Earlier checkpoints below are historical. Full main validation of the proxy fix remains separate.

Task `04-invoices-wallet-contracts.md#T-04.5.01.06`. Base is verified PR #328 merge `9960e956e105f0d8067cfbe8b6e52f67da4da41e`. Status: full interface and backend built and locally validated; committed combined coverage, independent review and CI remain.

Reuse cancellation intents/execution rather than inventing another refund path. A customer with contracts:sign and step-up can submit a reason and preferred destination for a published, current nonterminal contract. Request creates durable staff-review state and notifications only; no contract/refund mutation. Use current session/profile checks and idempotency, one unresolved request per contract, immutable customer request evidence.

Staff rejects with required explanation and customer support notification, leaving contract unchanged. Approval requires a concrete staff refund decision and reuses cancellation preparation/dual approval/execution. Do not mark request fulfilled before cancellation execution commits. Capture request ID binding in the immutable intent; execute can resolve the bound request in the same transaction. If independently cancelled/completed, show truthful terminal outcome and prevent stale review actions. Destination is preference, not permission to override mandatory electricity wallet rules.

Customer sees request pending/declined/fulfilled and explanation. Staff queue shows unresolved requests, reason and preference; approval opens existing cancellation decision with request context. Existing contract cancellations remain independently usable. Bilingual/RTL, required reason and exact retry identity.

Tests: real HTTP profile isolation, current permission/session, duplicate submit, stale version, approval/rejection concurrency, reason validation, rollback when audit/notification fails, customer cannot cancel directly, failed or awaiting second approval cannot resolve request, successful refund obligation creation resolves request atomically. Migrated DB guards and production browser request-review flow. Preserve bounded task scope.

## Backend checkpoint

Migration0146 adds retained, version-bound customer requests with one pending request per contract. Submission requires current published contract/profile/signing authority and step-up. It records review evidence and bilingual notices without cancelling service. Staff rejection requires an explanation and current authority. Prepared cancellation decisions may bind the request; execution resolves it atomically through the existing financial approval and refund transaction. Rejection invalidates an already prepared decision, including its read status. Independent terminal changes are presented as Closed rather than pending fulfillment.

Validation passes51 real HTTP cases across request/cancellation/customer-review flows and33 migrated database/upgrade cases. Tests cover profile isolation, CSRF/step-up, revoked permission, duplicate/idempotent requests, rejection, dual approval before mandatory wallet returns, rejection/execution races, and rollback when notices fail. API/DB types, targeted lint, generated OpenAPI consistency and database snapshot checks pass. No final combined coverage, independent approval or remote CI is claimed for this new batch.

Next: bilingual customer request/status controls, staff queue and review integration with the existing cancellation editor; then frontend/browser checks, committed combined coverage, independent exact-head review and CI before merge.

## Interface and proxy checkpoint

Customers can submit a reason and refund preference, resume pending requests, read rejection explanations and distinguish fulfilled cancellation from independent termination. Staff have a paginated request queue, explanation-required rejection and a request-bound entry into the existing financial cancellation editor. Stale-version requests cannot be approved. Password confirmation preserves request identity across retry.

Focused validation passes58 frontend tests and8 production Chromium flows,including both languages,step-up/reload,decline,resubmit and bound cancellation. API coverage collection passes60 tests;DB collection passes16 plus earlier upgrade evidence. Web types,lint,production build,44 bundle budgets and static security907 files pass.

Full main after #328,run35556867140,passed tests and security but failed its pilot proxy probe on the allowed11MiB upload with502. Browsers never ran,so combined coverage also failed from missing evidence. The test backend previously responded before consuming the upload; it now waits for request end and reports bytes received. The probe asserts all11MiB arrive. Local complete proxy integration passes cache,TLS,routing,body limits,SSE,WebSocket and quota checks. Remote confirmation remains required.

Final evidence gap: added a migrated-database check that typed request/cancellation foreign keys,checks and indexes exist in PostgreSQL. The focused DB suite now passes17 tests. Ten committed production browser flows pass;the Persian request panel was visually inspected. API/frontend combined coverage passed;final clean-head coverage collection follows this test-only commit.
