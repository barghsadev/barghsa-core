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

See [kanban continuation status](../kanban/CONTINUATION.md) for candidate next tasks and the separate automation restart blockers. All five CI jobs pass for PR #305 at `faf9a2de2825e2bb829699aec2802d68c2d1f2a8`, including combined source coverage. PR #305 is merged at `0b768cf1`. Manual feature batches are authorized; PR #306 merged the first wallet-history batch at `999a1f44`. PR #307 merged refund storage and reservation limits at `e326bdbe`; PR #308 merged invoice activity and customer history at `460c6d5f`; PR #309 merged manual wallet refunds at `d8df7986`. The active maintenance batch reduces repeated HTTP test migrations; external refunds are implemented locally and await review. Automatic restart still requires durable-state reconciliation.

Start only from a concrete remaining criterion. Use focused tests for edits, reuse matching source-bound evidence, and consolidate review/validation. Keep full API/worker setup builds separate from consumers in the same checkout, and never edit source/tests while their checks run. Preserve complete logs with concise summaries. Use RTK and the codebase graph when available.

On September 20 the user authorized repeated manual build/review/merge batches and withdrew the former token ceiling. Keep each merge gated on an independent exact-HEAD review and all CI checks. Preserve untracked user-owned `output/`. Scheduler and runtime-state changes are outside this manual flow.

## CI repair complete

[GitHub run 35498578584](https://github.com/barghsadev/barghsa-core/actions/runs/35498578584) passes tests with coverage thresholds, full browser/monorepo integrity, static security, complete-history secret scanning and combined source coverage. Its exact SHA matches the merged PR #305 source HEAD. CI now runs each unit suite once with coverage and at most two concurrent packages. Fixes cover build/test races, vulnerable dependencies, verified secret-scan false positives, database fixtures, SMS selectors, permission-race expectations and generated Python caches. Those baseline runs enforced coverage and security gates. The subsequent temporary PR policy is recorded in [CI fast mode](../kanban/CI-FAST-MODE.md).

PR #305 is merged. The current batch and remaining criteria are recorded in [kanban batch status](../kanban/batches/2026-09-20-http-fixture-template.md). No deployment or scheduler change was performed.
