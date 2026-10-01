# Operational list URL queries, October 1, 2026

## Kanban scope

This batch extends `07-ui-ux-design.md#T-07.18.02.04` to failed-job status/type/pages and notification delivery-history search, pages and open-dialog scope in both notification queue views. Other legacy filters and unfinished domain criteria remain open; global URL serialization remains partial. No supervisor assignment or completion history changes.

## Behavior and review

Failed-job links restore the applied lifecycle status, job type and page through reload and Back/Forward. Failed remains the default; all statuses is an explicit separate choice. Criteria changes reset pagination and private selection/confirmation work. Failed page reads retain accepted rows and selected jobs, and retry repeats the exact failed query. Page navigation closes stale confirmation and rejects late receipts. Permission denial discards private work. Job pages respect the existing API's maximum offset of 1,000,000.

Delivery-history links restore the open dialog, applied notification UUID/channel/outcome and its independent page. Row-specific links restore the fixed notification/channel scope and read-only search mode, including after reload. Successful history reads validate every response against the applied scope. Only explicit Search applies form drafts; invalid UUIDs cannot submit, retry preserves inputs and repeats the exact query. Submitting an unchanged search still refreshes its results. Closing the dialog records its closed state; Back reopens its prior scope. Unrelated queue and preview filters survive history navigation, and history reads use primitive criteria to avoid extra requests on parent refresh. Permission denial closes history and discards its private data. History pagination uses the shared bounded page contract independently of the stricter job API limit. Unsubmitted drafts, provider receipts, payloads, destinations and passwords are excluded from URLs.

Review repaired the existing delivery-search fixture, which returned 404 for the staff session and omitted the parent template catalogue. It now uses the current staff shell and a valid catalogue fixture; its authorization, response-scope, recovery and focus assertions remain intact. A regression test verifies unchanged-search refresh and exact-query recovery. Lazy route loading and standalone page/component behavior remain. No API, database, dependency, CI, scheduler or supervisor changes.

## Validation

All 1,887 web cases across 165 files and 53 dictionary cases pass. After pagination review, all 37 affected query, history and queue-recovery cases pass again. The release build and all 11 package type checks pass. Root lint and format, contract and suppression checks, all 64 release bundle budgets and backlog/diff checks pass. The pinned strict security scanner passes five fixtures and scans 1,367 files with zero findings or scanner errors.

All 68 distinct production browser scenarios pass across Chromium and mobile Safari: 24 new operational URL/history cases, 40 existing operational recovery cases and four existing delivery-search cases. After the final pagination adjustment, all 24 affected URL/history browser cases also pass against the final release build. Assertions cover reload, Back/Forward, explicit search versus drafts, scoped history, unchanged-search refresh, retry, confirmation invalidation, permission denial, independent queue/preview state, actual themes, scoped Axe checks and mobile bounds. Persian mobile rendering for jobs and both history views is inspected in light and dark themes. Repeated runs are not added to the scenario count.

## Publication and CI

The preceding notification panel commit is `6afc100fd01ac2e7ecaaa78027eca9f4cda2225d`. [CI run 36885805025](https://github.com/barghsadev/barghsa-core/actions/runs/36885805025) passes all five gates: tests, integrity, static security, secrets and combined-source coverage. The existing combined-coverage exemption supplies no coverage measurement.

This batch is published directly to main after local validation. Publication verifies local and remote SHAs, a clean worktree and exact-commit CI registration; the new CI result is pending at publication. Existing temporary fast mode and the combined-coverage exemption remain unchanged. No PR, handoff, historical loop-state or scheduler change is included.

## Commands

- `pnpm --filter @barghsa/web test`
- `pnpm --filter @barghsa/web exec vitest run src/components/NotificationDeliveryHistory.test.tsx src/lib/operations-list-query.test.ts src/pages/operational-queue-recovery.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs operations-list-query.spec.ts operational-queue-recovery.spec.ts notification-delivery-search.spec.ts --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs operations-list-query.spec.ts --project=chromium --project=mobile-safari --workers=1 --max-failures=2` — final affected browser rerun
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
