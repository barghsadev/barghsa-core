# Approval and reconciliation queue URLs, October 1, 2026

## Kanban scope

This batch extends `07-ui-ux-design.md#T-07.18.02.04` across the financial approval queue and reconciliation queue. Other legacy filters and unfinished domain criteria remain open; global URL serialization remains partial. Review reasons, resolution notes, confirmation state and credentials stay local. No supervisor assignment or completion history changes.

## Behavior and review

Approval status/pages and reconciliation status/severity/UTC date bounds/pages restore through direct links, reload and Back/Forward. Shared allowlists, canonical date-range validation and bounded page parsing reject malformed criteria. Defaults disappear from the URL; reconciliation explicitly distinguishes all statuses from the default open status. Exact linked approval requests retain their queue context when returning to the queue.

Applied reconciliation instants keep their seconds and milliseconds while date controls display minutes in the account timezone. Apply waits for timezone readiness; unchanged controls reuse the exact applied UTC bounds. Unchanged Apply still refreshes. Independent filter drafts survive paging and list recovery, while applied criteria changes mount a fresh scope. Failed page requests preserve accepted rows and retry the exact query. Confirmations and detail work close on page/history changes; immutable command generations reject late callbacks without dismissing a newer decision or reporting false success. Existing permission-denial clearing, financial step-up and action conflict behavior remain.

Review checks the two route adapters, page recovery/decision boundaries and date conversion. New deterministic regressions verify delayed timezone hydration and late callbacks against a newer decision. The initial callback test mock rendered no confirmation; correcting the mock makes that assertion meaningful. The initial Chromium date-flow assertions raced the API request after clearing filters; the final test waits for the exact unfiltered API query instead of assuming URL navigation means data has loaded. Neither test repair loosens an acceptance assertion.

## Validation

All 419 affected web cases across four files pass, including 21 query-normalization cases and three navigation regressions. The full web suite and unchanged dictionary suite are not rerun. All 48 distinct production browser scenarios have passing evidence across Chromium and mobile Safari: approval/reconciliation URL workflows, existing approval step-up/history/conflict flows, and reconciliation paging/action/access/recovery flows. The final eight reconciliation URL cases pass after the timing repair; repeated or failed executions are not added to the total. Both languages, actual themes, scoped Axe, mobile bounds, reload, Back/Forward, exact-query retry, draft exclusion/retention, confirmation disposal and access denial are verified. Persian mobile rendering is inspected for both queues in both themes.

Validation commands:

- `pnpm --filter @barghsa/web exec vitest run src/lib/decision-queue-query.test.ts src/pages/decision-queue-navigation.test.tsx src/pages/payment-review-recovery.test.tsx src/pages/admin-boundaries.test.tsx` — 419 pass.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/decision-queue-query.spec.ts e2e/approval-queue.spec.ts e2e/reconciliation.spec.ts --project=chromium --project=mobile-safari --workers=2` — 36 pass; four Chromium reconciliation URL cases initially fail on the test timing assertion above.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/decision-queue-query.spec.ts --grep 'reconciliation URLs' --project=chromium --project=mobile-safari --workers=2` — final eight pass.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/payment-review-recovery.spec.ts --grep reconciliation --project=chromium --project=mobile-safari --workers=2` — eight pass.

All seven root build tasks, all 11 package type checks, root lint, formatting, contract, suppression and all 64 final release budgets pass. Final test-only edits also pass web types and affected-file lint. Strict security passes five rule fixtures and scans 1,373 files with zero findings or errors. Backlog and diff checks pass before publication.

## Publication

This batch is published directly to main after local validation. Publication verifies local/remote SHA, clean worktree and exact-commit CI registration; new CI remains pending at publication. The preceding catalogue commit `967884262886489cc4863ec6bf5dbdc06ac4b328` has integrity, static security and secret-scanning success in [CI run 36892182530](https://github.com/barghsadev/barghsa-core/actions/runs/36892182530); tests remain running at the last readback. It is not reported as fully green. No PR, API, database, dependency, CI, handoff, historical loop-state or scheduler change is included. Existing temporary fast mode remains; its combined-coverage exemption supplies no measured coverage.
