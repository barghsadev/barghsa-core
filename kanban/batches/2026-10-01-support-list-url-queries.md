# Support and consultation URL queries, October 1, 2026

## Kanban scope

This batch extends `07-ui-ux-design.md#T-07.18.02.04` to customer tickets, staff tickets and the consultation work queue using the completed shared query hook. Global URL serialization remains partial; other legacy lists and unfinished domain criteria remain open. This manual batch does not change supervisor assignments or completion history.

## Behavior and review

Ticket URLs retain applied search, status, chronological order, numbered page and selected ticket. Customer links also retain active-profile scope. Existing active-ticket dashboard links and ticket links outside the displayed page continue to work. Filter or sort changes reset the page while retaining the selected conversation and its valid draft. Selection changes clear reply and assignment work. Restored pages, reload and Back/Forward use the applied criteria without unnecessarily reloading the list for a selection change.

The consultation queue retains status, assignment, priority, age, cursor and selected request. Filters clear cursor and selection atomically. A valid next page accumulates only when it follows the accepted page for the same criteria; restored pages replace unrelated accumulation. Previous navigation uses observed cursor history and never invents an earlier page after reload. Failed page recovery retains accepted work; repeated server cursors cannot cycle.

The adapters discard unknown fields, invalid identifiers and unsupported criteria. Number-valued age parameters decoded by the router normalize correctly. Private reply, financial offer and staff decision fields are not serialized. Both 401 and 403 clear private queue work. Changing the selected request invalidates pending financial reviews and resets private offer and reason drafts.

Review corrected missing consultation Previous navigation and prevented a late ticket mutation receipt from reopening a ticket after URL selection changed. Successful mutations reload the latest applied queue criteria; stale mutation errors do not appear on a different selected ticket. Clicking the already selected ticket still explicitly refreshes its details, preserving the established recovery action. Existing creation, reply, assignment, offer and financial-review contracts remain unchanged. One old consultation cursor fixture now uses UUIDs; an existing recovery test accepts a component type after pages gained optional query adapters. Existing assertions are retained. API, database, dependencies, CI, scheduler and supervisor are unchanged.

## Validation

The final full web suite passes all 1,830 cases across 158 files. All 53 dictionary cases pass. Root build, types, lint and formatting pass; final affected-file lint also passes after the same-ticket refresh correction. OpenAPI consistency, suppression checks, all 64 route budgets and backlog/diff checks pass. The pinned strict scanner passes five fixtures and scans 1,359 files with zero findings or scanner errors.

All 62 production browser scenarios pass in Chromium and mobile Safari. Twenty-four bilingual/themed URL journeys cover all three routes, applied API criteria, numbered and cursor pagination, reload, Back/Forward, independent selection and private-draft reset. Eight existing support recovery scenarios retain reply/creation/assignment work, retry exact failed pages and reject late detail reads after permission denial. Twenty-eight existing ticket scenarios cover uploads, related records, contact visibility, assignment, internal/public notes, read-only authority, stale reads and profile-independent deep links. Two consultation journeys cover staff offers, invoice/payment handoff and completion. Scoped Axe and mobile bounds pass; Persian mobile rendering is inspected in both themes. Failed and repeated runs are excluded from passing totals.

## Publication and CI

The preceding staff finance/order commit is `85e4c3baf6043312280a80695625a10c6ffb1e6e`; [CI run 36874987257](https://github.com/barghsadev/barghsa-core/actions/runs/36874987257) passes all five gates: tests, integrity, static security, secrets and combined-source coverage. This verifies the preceding fixture repairs remotely. Earlier failed or cancelled runs remain historical failures or cancellations. The combined-coverage success uses the existing exemption and supplies no coverage measurement.

This batch is committed and pushed directly to main after local validation. Remote SHA, clean worktree and exact-commit CI registration are read back. Remote CI for this new batch remains pending at publication. Existing temporary fast mode and the combined-coverage exemption remain unchanged. No PR, handoff, historical loop-state or scheduler change is included.

## Commands

- `pnpm --filter @barghsa/web test`
- `pnpm --filter @barghsa/i18n test`
- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs support-list-query.spec.ts support-queue-recovery.spec.ts consultation-journey.spec.ts tickets.spec.ts --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
