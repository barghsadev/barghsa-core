# Gift-code catalogue URL queries, October 1, 2026

## Kanban scope

This batch extends `07-ui-ux-design.md#T-07.18.02.04` across the promotion catalogue's five applied filters, UUID cursor and independent selected code's editor/usage statistics. Other legacy filters and unfinished domain criteria remain open; global URL serialization remains partial. No supervisor assignment or completion history changes.

## Behavior and review

Links restore applied code search, active/inactive state, fixed/percentage discount type, public/profile eligibility, expiry and exact cursor. Only explicit Search applies local filter drafts. Search clears cursor and editor together in one navigation; unchanged Search still refreshes. Reload and Back/Forward restore applied criteria and selected code. UUID selection is independent of catalogue pagination. Unsaved code settings, profile picks, passwords and provider receipts are excluded from URLs.

Load more keeps appended rows, deduplicates overlapping IDs and writes the next cursor to the URL. Reload at a cursor requests that page directly. Back to an earlier cursor replaces obsolete later rows. Failed pages retain accepted rows, pause commands and retry the exact query. Cursor cycles and late responses cannot replace accepted work. Explicit successful-list refresh returns to the first page while retaining a valid selected editor and its draft; failed-query refresh retries the failed cursor. Permission denial discards private work and guarded recovery uses the current public URL scope.

Restored editor drafts initialize only after statistics and the catalogue baseline are ready, avoiding a false stale-draft state if statistics arrive first. Failed statistics reads retain existing edits and retry independently. An unavailable restored code can be closed before a draft exists. Selection, criteria and cursor changes invalidate old confirmation and late receipts. Existing date conversion, untouched instants, step-up confirmation, saved-setting reset, receipt checks and standalone consumers remain. No API, database, dependency, dictionary, CI, scheduler or supervisor change is included.

## Validation

All 1,905 distinct web cases have passing evidence: the full 1,903-case suite across 167 files passes, and the final 45 affected cases include two subsequently added deterministic restored-editor regressions. Repeated cases are not added to the total. All 30 distinct production browser scenarios pass across Chromium and mobile Safari: 16 new URL/selection/cursor flows and 14 existing editor/recovery/date flows. Both languages and actual themes, scoped Axe, mobile bounds, retries, reload, Back/Forward, draft exclusion, confirmation invalidation and denial are verified. Persian mobile rendering is inspected in light and dark themes.

Root build, all 11 package type checks, lint, format, contract, suppression and all 64 final release budgets pass. The initial budget invocation ran before the build completed and failed on its missing auth manifest; the subsequent check on the completed release build passes. Backlog and diff checks pass before publication. Strict security passes five rule fixtures and scans 1,369 files with zero findings or errors; the final added page-test cases receive a separate affected-file strict check. No API or database code changes require a separate domain test rerun.

## Publication and CI

The preceding operational-list commit is `0fb418619b236a487dfd78c0093568e70bff7831`. [CI run 36887896523](https://github.com/barghsadev/barghsa-core/actions/runs/36887896523) passes all five gates under existing temporary fast mode. Combined coverage remains an exemption, with no measured coverage.

This batch is published directly to main after local validation. Publication verifies local/remote SHA, clean worktree and exact-commit CI registration; its new CI remains pending at publication. No PR, handoff, historical loop-state or scheduler change is included.

## Commands

- `pnpm --filter @barghsa/web test`
- `pnpm --filter @barghsa/web exec vitest run src/pages/gift-code-recovery.test.tsx src/pages/admin-gift-codes.test.tsx src/hooks/useGiftCodeCatalogue.test.tsx src/lib/gift-list-query.test.ts`
- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs gift-list-query.spec.ts gift-code-recovery.spec.ts gift-codes.spec.ts --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper, retaining rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
