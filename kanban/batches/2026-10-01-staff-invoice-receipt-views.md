# Staff invoice receipt views, October 1, 2026

## Scope and behavior

This related batch extends `07-ui-ux-design.md#T-07.18.03.03` and `07-ui-ux-design.md#T-07.18.01.05` across pending and reviewed invoice bank receipts. Both queues reuse the shared table/card controls and accessible scrolling table. Each view presents receipt and invoice IDs, exact receipt amount, bank, deposit date, status and submission time, with an action opening the selected receipt. Pending cards now include the previously missing receipt ID and deposit date. Narrow screens initially show cards; wider screens initially show tables. Preferences are independent for pending/history lists and authenticated accounts.

View changes preserve queue criteria, exact pagination cursors, selected review and rejection drafts without additional queue, detail or allocation reads. Existing recovery, authorization and financial command ownership remain in their original components. Deposit dates are formatted as Gregorian date-only values with localized text and digits; UTC formatting prevents account timezone offsets from changing the recorded day. Submission instants still use the account timezone. Missing or invalid date metadata renders a dash rather than an invented calendar day. No API, schema, dictionary or dependency change is needed.

## Review

Production browser testing found that admin routes did not provide the authenticated account to the shared preference context, so view choices disappeared on reload. The admin route now passes the user ID from its existing session read into a lazy account-context layout. No additional authentication request is introduced. A regression verifies remount persistence, account isolation and absence of shared storage writes when identity is unavailable. The customer layout remains under its existing provider.

The table's accessible name includes the localized view label to distinguish its scrolling region from the parent queue. Bilingual browser checks exercise keyboard scrolling, exact large amounts, timezone-crossing submission times, deposit days, failed-page retry, independent preferences and reload restoration. English WebKit uses different valid Intl punctuation from Node; the fixture computes its exact timestamp expectation in the browser instead of weakening timezone assertions. Persian light/dark mobile rendering is visually inspected.

Release budgets caught a small bootstrap overage. Shared list-query serialization now uses one computed-key object and reads order once, retaining the same normalization, defaults, prefixes and unrelated route context. Affected query and bound-navigation regressions cover that change. Generated shared declarations were rebuilt after a cached dependency restore left them unavailable; the uncached root typecheck passes. No source type errors, budget increases or relaxed checks are accepted.

## Validation

- From `apps/web`, `pnpm exec vitest run src/hooks/useListQuery.test.tsx src/lib/*query.test.ts src/pages/crm-recovery.test.tsx src/pages/staff-order-list-query.test.tsx src/pages/support-list-query.test.tsx src/components/record-list-query.test.tsx src/components/StaffInvoiceReceiptList.test.tsx src/components/InvoiceBankReceiptQueue.test.tsx src/components/InvoiceBankReceiptHistory.test.tsx src/hooks/useListView.test.tsx src/pages/admin-account-context.test.tsx` passes 337 cases across 25 files. The shared query hook is checked again after the final order-read simplification. Repeated cases are not additional coverage.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/staff-invoice-receipt-views.spec.ts --project=chromium --project=mobile-safari --workers=2` passes eight new production browser scenarios across both languages and actual light/dark themes. Sixteen existing receipt recovery/query scenarios also have passing evidence in the initial combined run; failed new cases from that run are excluded. Scope includes Axe, contrast, mobile document bounds, keyboard scrolling, exact dates/money, retained drafts, no extra presentation reads and cursor/preference persistence.
- Root build, types, lint, formatting, contract/suppression, all 64 unchanged release budgets and backlog/diff checks are verified before publication. Strict security passes five rule fixtures and scans 1,384 files with zero findings/errors. The full web suite and unchanged dictionaries are not rerun.

## Publication and remaining scope

The preceding CRM commit `eaa16615e226d61a386f60080ea3bd66352ac63f` passes all five gates in [CI run 36899468060](https://github.com/barghsadev/barghsa-core/actions/runs/36899468060).

Publication is directly to main after validation, with local/remote SHA, clean tree and exact-commit CI registration read back. New CI remains pending at publication. Wallet top-up receipts, broader search/sort criteria and an integrated image/document preview remain separate work; the parent list and receipt-pattern criteria stay partial. Existing invoice bank metadata, verification timeline and evidence links are retained rather than counted as new implementation. No PR, supervisor state, handoff, historical completion or scheduler changes are included. Temporary CI fast mode and its combined-coverage exemption remain unchanged; measured coverage is not claimed.
