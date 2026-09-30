# Staff finance lists and independent recovery — October 1, 2026

## Kanban scope

- `07-ui-ux-design.md#T-07.18.01.06`: extend shared ListPage adoption to the staff invoice ledger, pending invoice-receipt queue and reviewed receipt history. Shared cursor pagination now also supports Previous/Next histories.
- Staff list/detail compositions contribute to `07-ui-ux-design.md#T-07.18.03.02` and `T-07.18.03.03` without claiming the whole domain patterns complete.
- Other product/staff list adoption, URL serialization of these legacy staff filters, broader search/sort and remaining domain sections stay open. The all-list parent criterion remains partial.

## Behavior and review

Ledger page loads retain accepted rows and the selected invoice. Local list retry repeats the failed cursor without reloading invoice detail; detail retry only requests the selected invoice. Exact profile/order filters and PostgreSQL timestamp precision remain intact.

Pending receipt list retry preserves the selected receipt, rejection explanation, allocation and financial review state. Explicit Refresh keeps its established wider refresh behavior. If the queue denies permission, retained rows and the selected review/confirmation are discarded.

Receipt history retains the accepted page during loading and errors, supports local retry of the exact failed cursor, and disables both paging actions while pending. A failed page offers Retry before navigation resumes. Applying filters clears previous rows and pagination; reapplying an unchanged invoice filter now actually reloads instead of leaving an empty loading state. Forbidden history rows are discarded and do not reappear on a subsequent failure.

Staff controls wrap on narrow screens. Ledger filter inputs shrink inside their grid rather than overflowing the page. Both invoice tables reuse the existing horizontal ScrollArea with keyboard access in Safari, preserving exact money, date and VAT content. Persian and English dictionaries are reused. The detail, finance review, step-up, dual approval and handoff actions remain outside list loading states.

Review covers independent retry dependencies, cursor stack behavior, permission failures, stale-request cancellation, financial confirmation state, mobile widths and accessible scrolling. No API, database, dependency, scheduler or CI change is included.

## Validation

Evidence logs: `/tmp/barghsa-staff-finance-list-*.log`.

The 1,191-test web suite and 68 shared UI tests pass. After the final accessibility change, all 19 affected component tests pass. Twelve new staff browser scenarios pass across Chromium and mobile Safari; sixteen related customer recovery and financial-view cases pass in Chromium, for 28 distinct browser scenarios. Build, root typecheck/lint/format/contract/suppression checks, all 64 route budgets and backlog/diff validation pass. New tests cover independent list/detail retries, preserved drafts, exact failed queries, Previous/Next controls, permission denial and unchanged-filter reload. Persian mobile Chromium and Safari rendering is inspected.

Initial browser failures exposed mobile input overflow and a non-keyboard-accessible line-items scroll region. Both are fixed using existing responsive styles and the shared ScrollArea. A duplicate landmark name was corrected, and a receipt-history fixture now uses its accessible dropdown name. Failed runs are excluded from passing totals.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/ui test`
- `pnpm --filter @barghsa/web exec vitest run src/components/InvoiceLedger.test.tsx src/components/InvoiceBankReceiptQueue.test.tsx src/components/InvoiceBankReceiptHistory.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test staff-finance-list-recovery.spec.ts --project=chromium --workers=2`
- Staff cross-browser cases also run with `--project=mobile-safari`; Persian ledger cases are captured again for viewport rendering without counting them twice.
- Related Chromium regressions: `customer-list-recovery.spec.ts customer-financial-history-views.spec.ts --project=chromium --workers=2`
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding customer-list batch is published as `7dfd27f6bb2cc70f692e5eb340e1fce2e50216c0`; CI run `36780246336` passes all five gates under the existing temporary fast mode. The combined-coverage gate remains an exemption, not measured coverage. This staff batch is published directly to main as `7f54512d6c69e3a43783594ad0e5518065324bde`; its remote commit is verified and CI run `36782061024` passes all five gates.
