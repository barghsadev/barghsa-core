# Solar staff queue URLs, October 1, 2026

## Scope and behavior

This batch extends `07-ui-ux-design.md#T-07.18.02.04` across postal lanes and three solar staff cursor queues. Request and pending-file cursors use independent URL prefixes. Postal lane changes reset their own cursor; malformed lanes and non-UUID cursors are rejected. Reload and Back/Forward restore the applied scope. Review reasons, guidance drafts, document previews, confirmations and credentials remain local. Other legacy filters and unfinished domain criteria remain open; global URL serialization remains partial.

Successful next pages append and deduplicate accepted rows; history and restored pages replace the current window. Failed next-page reads retain accepted rows, selected explanations and guidance, retry exactly and avoid refreshing sibling resources. History navigation disposes of obsolete selected work and confirmations while retaining independent guidance edits. Immutable command generations and unmount guards reject delayed reviews and action callbacks without closing newer work. Both 401 and 403 queue responses clear private work.

## Review

The two route adapters, three API cursor contracts, page recovery and decision callbacks were reviewed. Existing standalone consumers retain local navigation. Nested `main` landmarks are removed. Browser regression checks caught a disappearing More control during a pending read; it now remains visible and disabled, and repeated cursors cannot advance. Three deterministic cases cover that behavior. Another regression verifies that a successfully created contract keeps its result link when refreshing resets a restored cursor. The existing recovery harness accepts both optional page-prop types without weakening its assertions.

## Validation

- `pnpm --filter @barghsa/web exec vitest run src/lib/solar-staff-query.test.ts src/pages/solar-queue-navigation.test.tsx src/pages/admin-solar-queues.test.tsx src/pages/solar-list-recovery.test.tsx src/pages/solar-documents.test.tsx` passes all 37 cases across five files. This includes 13 normalization cases, seven navigation/result regressions and 17 existing recovery/document cases. The full web suite and unchanged dictionary suite are not rerun.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/solar-staff-query.spec.ts e2e/solar-staff-list-recovery.spec.ts e2e/solar-final-rejection.spec.ts e2e/solar-journey.spec.ts --grep 'solar .*URLs|solar .*queue|staff can reject|solar request moves|staff confirms the reviewed' --project=chromium --project=mobile-safari --workers=2` passes all 42 final production scenarios. These include 24 URL flows, 12 existing queue recovery flows and six review/rejection/contract-invoice journey cases. The initial pending-control failures are fixed; repeated or failed executions are not added to this total.
- Both languages, actual themes, scoped Axe, mobile bounds, independent queries, direct/reload/history navigation, exact retry, local draft retention/exclusion, duplicate-page boundaries, confirmation disposal and both denial statuses are verified. Persian mobile rendering is inspected for all three queues in both themes.
- Root build passes all seven tasks; root types pass all 11 tasks. Root lint and final affected-file lint, formatting, contract, suppression and all 64 final release budgets pass. Strict security passes five rule fixtures and scans 1,375 files with zero findings or errors. Backlog and diff checks pass before publication.

## Publication

The preceding decision-queue commit `fd1d1d1920bf8178e7a8ee3ae9efd069128b6d79` passes all five CI gates in [run 36893772659](https://github.com/barghsadev/barghsa-core/actions/runs/36893772659). The earlier catalogue run `36892182530` finishes cancelled, not green.

This batch is published directly to main after local validation, with local/remote SHA, clean worktree and exact-commit CI registration read back. New CI remains pending at publication. No PR, API/database/dependency/CI, supervisor assignment, handoff, historical completion or scheduler change is included. Existing temporary fast mode and its combined-coverage exemption remain; no measured coverage is claimed.
