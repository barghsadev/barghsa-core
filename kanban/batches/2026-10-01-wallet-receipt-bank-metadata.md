# Wallet receipt bank metadata and payment completion

Date: October 1, 2026. Manual batch, published directly to main under the user's instruction.

## Task scope

- `07-ui-ux-design.md#T-07.18.03.03`: complete the missing wallet receipt bank-name metadata across customer submission, staff table/cards, detail and financial review. The parent remains partial: the verification timeline and broader receipt search/sort are still open.
- `04-invoices-wallet-contracts.md#T-04.2.02.03` and `04-invoices-wallet-contracts.md#T-04.2.02.04`: preserve recorded bank names through sealed Pending receipts and finance confirmation.
- `04-invoices-wallet-contracts.md#T-04.CC.07.03`: repair wallet payment confirmation identity so valid acknowledgements survive unrelated renders, while changed reviews still require fresh confirmation.

## Delivered

Customers may supply a bank name of at most 128 characters on one line. Wallet and invoice receipts share the existing normalization rule. Invalid names fail before upload; blank names remain absent. Customer confirmation displays the normalized name and submits only reviewed metadata. Both HTTP and service submission adapters forward it.

Receipt metadata stores the name alongside the sealed attachment. Customer and staff review hashes include it when present. Changed names conflict before Pending submission or wallet credit. Same-name retries retain the original review, sealed evidence and single ledger transaction. Older no-name receipts retain their metadata/snapshot shape and existing hashes; no migration or invented historical bank name is needed.

Staff wallet cards, tables and detail display the recorded name; the existing financial summary now receives it. Returned review metadata must match the selected receipt before confirmation is enabled. Unknown legacy names use the existing empty marker.

The wallet route uses the established automatic component splitting instead of loading its form into every customer page. All 64 previous size limits remain unchanged, and a new 300 KB limit measures the complete wallet page, including bootstrap/static dependencies. Electricity ordering is 246.57 KB against 255 KB; the wallet is 247.52 KB against 300 KB.

Browser review also exposed an existing payment-confirmation identity problem. `WalletInvoicePaymentPanel` now memoizes its command from the captured intent, locale and displayed amount. Unrelated renders no longer discard valid payment responses. Changed invoices/contracts continue to require a new review, and ambiguous retries reuse the exact captured request. Browser fixtures retain the requested document language across asynchronously loaded routes.

## Validation and review

- 311 distinct affected unit/integration cases have passing evidence: shared 101, API 105, web 80, dictionary 25. Repeated cases are not counted again.
- Shared: `pnpm --filter @barghsa/shared exec vitest run src/finance/wallet-bank-receipt-topup.test.ts src/finance/invoice-bank-receipt-upload.test.ts src/finance/bank-receipt-review.test.ts src/finance/invoice-bank-receipt-submission-review.test.ts` — 101 cases across the three existing matching suites; no claim that a missing fourth test file ran.
- API: five receipt/controller suites pass in the initial seven-suite run; the two failing top-up suites pass after repairing field forwarding. `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/wallet/bank-receipt-topup.integration.test.ts src/wallet/bank-receipt-topup-http.integration.test.ts` — 16 pass. The final expanded HTTP suite also passes independently. The initial failed invocation is not represented as green.
- Web: five affected suites pass 78 cases. The final wallet/action/return-library check passes 26 cases, including two additional return-library cases; 80 distinct cases total.
- Dictionary: `pnpm --filter @barghsa/i18n exec vitest run src/messages.test.ts` — 25 pass, including dictionary parity/interpolation.
- Final production browser command: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/staff-wallet-receipt-views.spec.ts e2e/customer-receipts.spec.ts e2e/online-payment-return.spec.ts e2e/wallet-invoice-payment.spec.ts --project=chromium --project=mobile-safari --grep "wallet|payment return"` — all 44 pass. Covers both languages, both staff themes, Axe/contrast, mobile bounds, exact amounts/dates, preserved preferences/drafts, retries, changed financial reviews, timezone recovery and gateway-to-invoice return scope. An earlier 70-case receipt run across all five browser projects also passed; the final command verifies the changed route/payment behavior.
- `pnpm build` — 7 tasks pass; `pnpm typecheck` — 11 tasks pass; `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:suppressed-errors`, `pnpm check:bundle` — pass. All 65 size checks pass.
- Strict security: five rule fixtures pass; 1,390 files scanned, zero findings/errors.
- `python3 kanban/scripts/build_backlog.py --check` — 1,355 tasks and 116 traceability entries valid; `git diff --check` — pass.
- Review checked legacy snapshot/hash preservation, both submission adapters, sealed attachment lookup, staff review/confirmation consistency, retry conflicts, amount integrity and command identity. Integration/browser failures were repaired without weakening financial guards or existing size limits.

## Publication and remaining work

The preceding receipt-composition CI run `36907844718` passes all five jobs. This batch is committed and pushed directly to main, with local/origin/GitHub SHA, clean tree and exact-commit CI registration read back. New remote CI is pending at publication and is not claimed green.

Wallet receipt verification timelines, broader receipt search/sort and other unfinished product requirements remain open. No historical loop-state, supervisor state, handoff or completion ledger is rewritten. Existing CI fast mode and coverage exemption remain unchanged.
