# Payment review and reconciliation recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage adoption for staff wallet receipt reviews and reconciliation exceptions. Existing invoice ledger, invoice receipt queues/history and contract finance queues are already adopted and are unchanged.

This batch also improves recovery in the existing bank receipt list/detail pattern, `07-ui-ux-design.md#T-07.18.03.03`. Broader receipt columns, bank metadata and verification timelines remain open. These parents remain partial. This is recovery work on existing payment/reconciliation journeys; it does not mark domain requirements newly complete. Other list adoption, legacy filter URL serialization and broader search/sort remain open.

## Behavior and review

Receipt queue retries keep accepted receipts, the selected receipt, rejection/emergency reasons and invoice allocation. Unchanged rows do not trigger redundant detail or financial reads. Detail and financial review each have independent recovery. Decision controls wait for active queue/detail/financial reads; failed financial review blocks confirmation while rejection can still proceed after that read settles. Queue refresh does not hide an uncertain write error or pretend a decision succeeded. A malformed decision response retains work and reports the failed confirmation.

Fresh receipt eligibility invalidates obsolete financial confirmation. Selection changes clear the prior receipt's drafts. Read permission denial clears private receipts, selected work, allocation and confirmation. Generation guards prevent older financial/queue responses and password verification from reviving denied work or submitting an obsolete decision. The bank receipt confirmation still uses the displayed financial review hash, exact invoice binding, CSRF and existing step-up/dual approval rules.

Reconciliation retries keep accepted rows, the applied criteria/offset and an open investigation note or frozen confirmation. Permission checks recover independently from list reads. Retry controls inside the open detail/confirmation allow recovery without closing a draft. Fresh exception changes or revoked permissions clear stale decisions; changed filters hide older results immediately. The table uses a keyboard-accessible horizontal viewport and responsive filter layout. Existing status actions, mandatory explanation, account-timezone conversion and half-open date range are retained.

The shared confirmation dialog now checks its mounted action and current disabled state after password verification, and ignores obsolete responses/completion. A verification that finishes after closing or disabling the dialog cannot submit the command. English/Persian copy, RTL and accessibility remain supported.

No API, database, dependency, permission-model, scheduler or CI configuration changes are included.

## Validation

Evidence logs: `/tmp/barghsa-payment-review-*.log`.

The final web regression passes all 1,290 tests in 127 files. The related run passes 436 cases in four files, including fifteen new recovery/race cases, existing wallet receipt decisions, admin boundaries and multipart confirmation. All 53 dictionary tests pass.

All 26 production browser cases pass without retries or failures on Chromium and mobile Safari: sixteen new bilingual recovery cases, six financial receipt review cases and four existing reconciliation cases. Accessibility, mobile overflow and horizontal keyboard scrolling assertions pass. Persian mobile receipt allocation/rejection and reconciliation rendering is inspected.

Root build/typecheck/lint, contract and suppressed-error checks and all 64 route budgets pass. Final targeted lint/typecheck, root formatting and backlog/diff validation are checked before publication. The first route-budget attempt overlapped a build and lacked the unfinished auth manifest; the check passes against the completed build. Earlier repeated unit runs are excluded from final passing totals.

The browser run reuses the existing production static-server harness and one worker. Older browser fixtures now use persisted locale and authenticated staff. Reconciliation permission-change assertions use the explicit access refresh; ordinary list retry does not reread access.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/pages/payment-review-recovery.test.tsx src/pages/AdminWalletReceiptsPage.test.tsx src/pages/admin-boundaries.test.tsx src/components/TeamActionDialog.multipart.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs payment-review-recovery.spec.ts bank-receipt-review.spec.ts reconciliation.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Final targeted ESLint/Prettier checks cover edited source, tests and progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding contract finance batch is published as `8cbd24f6971a5cea379990226c7f2291ee2b61ce`; CI run `36815639338` passes all five gates under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This payment review batch is committed and pushed directly to main after review and related checks. Its remote commit and CI are read back after publication. No PR is created. The all-list and receipt-pattern parents remain partial for the open work listed above.
