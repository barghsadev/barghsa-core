# Repair sprint handoff

Local repair work is complete on `codex/audit-fixes` at `7b45c21507ad4fae597e4b00227f3a770b25f7e9`. No further step-by-step repair batches are queued. See [final checkpoint](final-repair-checkpoint.json) for passing checks and precise revision reuse, [fix plan](fix-plan.md) for scope, and [acceptance](acceptance-closure.json) for remaining criteria.

## Current disposition

219 verified / 54 partial / 49 deferred / 0 pending of 322 claims. Saved PRs: 242 closed/59 open/0 unreviewed of 301. Historical skips: 8 verified/1 partial/49 deferred of 58. Every saved PR statement is dispositioned; source refreshes retain old hashes. Open means an exact owner, future-consumer or external prerequisite remains; it does not automatically mean a new defect.

Complete Chromium suites: 769 passed against optimized production, and 769 passed against the unminified coverage build. All unchanged combined coverage gates pass. Actual local image lifecycle checks pass. The API broad run's two timing-fixture failures are resolved by the 103-case focused rerun; new boundary cases pass separately. Overlapping runs are not added. Earlier failed logs remain archived alongside successful reruns.

## Preserve completed work

Reuse source-bound authentication, profiles, CRM, finance, notification, UI, database, operations and loop reviews in [step evidence](evidence/step-reviews.json). Read the active documents first; do not routinely reread the historical archive or rebuild verified workflows.

- Apply migrations through 0134 before API traffic. Reconcile legacy electricity identities and nonnegative limits before seed/constraint validation. Historical traces stay NULL. Published image tags and production seed remain separate evidence.
- Do not charge DRAFT orders: the real submission caller remains a future consumer. Refund/order/contract/document workflows and legacy invoice/reversal constraint validation keep their recorded prerequisites.
- Notifications require coordinated migrations/workers, published templates/mappings and retirement of old writers. Reminder pools need at least 2 connections. Follow [delivery recovery](../docs/operations/notification-delivery-recovery.md) and [template seeding](../docs/operations/notification-template-seeding.md). No historical backfill/resend or live send is authorized.
- Ship storage API/helpers together; allow If-None-Match in bucket CORS, drain old writers and expire old PUT URLs for at least 1 hour. Reconcile deployed lifecycle/MinIO multipart settings. Real bucket/elapsed-day expiry and future scanner/quarantine/document consumers remain unverified. Manual hold changes must not race classification; independent hold authority needs provider Object Lock.
- Ship web/proxy cache changes together. Production TLS/firewall/load, off-server backups, secrets, installed schedules, recovery exercises and delivered alerts remain unverified. Scheduler and PR304 remain untouched.

## Decisions and future work

The six already-recorded owner questions remain in [progress](progress.json): recovery policy, signed callback CSRF wording, native CSP-report exception, 38 base-column deviations, Node 24 requirement and Base UI requirement. Preserve them; do not repeatedly reask or silently approve them.

Retain Vite SPA/ADR004, supported manual identity verification, approved pre-login CSRF and the September 13 limited trusted server-side secret uses. Dependency license restrictions are waived. Ticket categories are General/Billing/Orders. Support contacts remain info@barghsa.com, 021-26658042, 09002550292. Auth initial load 150 KB and estimator 900 KB are separately measured; other numeric budgets and coverage floors are unchanged.

[Skipped-work handoff](skipped-work-handoff.md) orders the remaining 49 deferred historical claims by dependencies. Partial claims separately retain actual future consumers, manual IDE proof, infrastructure and operations requirements. No provider, deployment or scheduled-exercise success is implied by local checks.

## Continuing efficiently

See [kanban continuation status](../kanban/CONTINUATION.md) for queue validation, candidate next tasks and the separate automation restart blockers. The repairs are now published in PR #305, but its original CI run failed. CI repair commit `861780bf` passes the full CI test stage and both security checks; coverage and browser checks remain pending. Database fixtures now close connections without forced termination. The completed prior browser run passed 768 of 769 scenarios; its remaining ambiguous SMS status selector is repaired and all 50 repeated SMS scenarios pass locally. The selector follow-up still needs a complete GitHub run before the next feature batch. Local validation above does not certify CI success.

Start only from a concrete remaining criterion. Use focused tests for edits, reuse matching source-bound evidence, and consolidate review/validation. Keep full API/worker setup builds separate from consumers in the same checkout, and never edit source/tests while their checks run. Preserve complete logs with concise summaries. Use RTK and the codebase graph when available.

The original repair sprint permitted local edits and explicit commits only. The subsequent CI repair request authorizes updating existing PR #305. Merge, deployment, scheduler/runtime state changes and PR304 changes remain outside this follow-up. Preserve untracked user-owned `output/`. Latest account meter: 22% weekly used, below the 50% ceiling.

## Latest CI follow-up

The complete test/coverage job passes on `861780bf`, and the complete browser/integrity job passes on `9ccaea81`. Follow-ups cover both valid rejection timings in mutual administrator role removal (18 focused tests pass), and separate the PgBouncer lock-holder setup budget from its unchanged 200 ms timeout test (all 760 database tests pass with coverage). CI runs each suite once with coverage and at most two concurrent packages. Test scope and coverage thresholds are unchanged. The latest combined follow-up still requires a complete GitHub run; exact observations are in `audit/progress.json`.
