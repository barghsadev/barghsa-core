# Contract end-of-term completion

Canonical task `04-invoices-wallet-contracts.md#T-04.5.01.03`, system completion portion. Build on verified PR #325 merge fa6a383b9bd5369390d4175c9ac7d59a2ba0313c. All five CI gates and its exact-HEAD approval passed before merge.

Add an explicit optional service end timestamp to the immutable version context. Validate the interval when a start exists. Draft API edits must create a new version for an end-date change; omitted end dates preserve the current value for existing clients. Publication freezes the dates and the customer/staff checklist displays them. Do not infer a term end from arbitrary JSON or populate legacy contracts with invented dates.

A bounded worker poll completes only Active versions whose recorded end date has arrived. Database evidence, state guards and system audit are atomic, immutable and idempotent. Concurrent workers and state changes are safe. Preserve legacy Completed records. Completed means the service term ended; it must not settle balances, cancel invoices, finish refunds or claim financial closure. Separate financial closure, amendments, cancellation/refund obligations and general editing UI remain unfinished.

Implementation and focused local validation pass: 61 database cases including upgrades and concurrent completion, 62 HTTP cases, 15 worker cases including the compiled worker process, 17 frontend cases and six production browser flows. API/web/database/worker types, targeted lint, formatting, migration snapshot, OpenAPI, all 44 bundle budgets, backlog validation and static analysis pass. Coverage reports were collected from the exercised processes and tests. Final committed combined coverage, independent review and CI remain.
