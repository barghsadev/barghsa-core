# Shared currency, wallet and invoice display — October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.26.01.01` — complete: reusable `Currency` with exact integer IRR, localized display, explicit IRR suffix/digits-only options, exact parenthesized toman equivalence and default/large/small variants. Published numeral preferences apply to both units. Invalid or already lossy values display an unavailable marker.
- `07-ui-ux-design.md#T-07.26.01.02` — complete: `WalletBalanceCard` reuses Currency for available/posted/reserved funds, hides zero reservations and shows the existing server-calculated shortage warning in red. One accessible link makes the whole card and its visual Charge Wallet action navigate to the wallet without nested interactive elements.
- `07-ui-ux-design.md#T-07.26.01.03` — complete: the existing chronological wallet history is exposed as `TransactionList`, retaining its compatibility alias. Shared Currency now respects published numerals across both layouts. Type icons/labels, signed completed amounts, state badges, descriptions, localized recorded dates, invoice references and cursor pagination retain their existing behavior.
- `07-ui-ux-design.md#T-07.26.01.04` — complete: `InvoicePaymentSummary` reuses Currency for total, paid and remaining amounts. Existing exact progress calculation, green fill, state exclusions and current server-reviewed wallet funding/confirmation gates remain verified.

## Build and review

The batch fills display/navigation gaps in existing wallet and payment flows. Exact toman conversion preserves the fractional rial equivalent, including negative amounts below one toman and values above JavaScript's safe-number range. It does not change submitted money or payment processing.

Visual review found a large balance breaking its final digits onto another line. The large Currency variant now scales long amounts to its container and places the toman equivalent below them. Browser tests prove a 19-digit balance remains on one line in narrow desktop cards and mobile layouts across both languages and numeral systems. Persian dark mobile balance/card rendering was inspected. Live numeral changes and layout switches do not read history again.

## Validation

- `pnpm --filter @barghsa/i18n test src/numbers.test.ts` — **27 passed**.
- `pnpm --filter @barghsa/web test src/components/Currency.test.tsx src/components/WalletBalanceCard.test.tsx src/components/WalletTransactionRecords.test.tsx src/components/WalletTransactionList.test.tsx src/components/InvoicePaymentSummary.test.tsx src/pages/WalletPage.test.tsx src/pages/WalletPage.errors.test.tsx src/pages/DashboardPage.test.tsx` — **116 passed** after review.
- With `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173`, `pnpm --filter @barghsa/web e2e e2e/money-components.spec.ts --project=chromium --project=mobile-safari --workers=2 --max-failures=1` — **8 passed** on the final build.
- With the same environment, `pnpm --filter @barghsa/web e2e e2e/dashboard-widget-loading.spec.ts e2e/wallet-invoice-payment.spec.ts e2e/wallet-receipt-timeline.spec.ts --project=chromium --project=mobile-safari --workers=2 --max-failures=1` — **32 passed** on the final build. Coverage includes exact ambiguous retries, step-up, changed amount/contract reviews, foreign/incomplete reviews, insufficient funds, timezone recovery, receipt privacy/dates and cursor scope.
- These are **143 distinct unit cases and 40 distinct browser scenarios**. Repeated/failed attempts are excluded. The initial test assumptions about a localized label, Intl negative-sign placement and alert attributes were corrected; review strengthened balance wrapping checks.
- Root `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:suppressed-errors` and `pnpm check:bundle` — **pass** before publication, with all **66 unchanged** budgets. Backlog validation and whitespace checks also pass.
- Strict security scanner — all five fixtures pass; **1,428 files**, **0 findings**, **0 scanner errors**.

## Publication and limits

Publish directly to main after validation, then read back the local/origin/GitHub SHA, clean worktree and exact-commit CI registration. The preceding document-actions run `36978507843` has successful integrity/security/secret jobs while tests remain in progress at the last readback; it is not reported as fully green. New remote CI remains pending at publication.

No dependencies, endpoints, schema changes or budget increases are required. Other kanban parent criteria remain open. Historical supervisor state, scheduler, handoffs and existing CI fast mode/coverage exemption remain unchanged.
