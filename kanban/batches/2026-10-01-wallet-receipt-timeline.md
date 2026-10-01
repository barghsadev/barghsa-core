# Wallet receipt details and verification timeline

Date: October 1, 2026. Manual batch, published directly to main under the user's instruction.

## Task scope

- `07-ui-ux-design.md#T-07.18.03.03`: fill the missing wallet receipt verification timeline in staff detail. Existing invoice timelines and evidence previews remain in use. Broader receipt search/sort still keeps the parent partial.
- `04-invoices-wallet-contracts.md#T-04.3.02.03`: add customer wallet receipt metadata, decisions and visible rejection reasons to transaction history.
- `04-invoices-wallet-contracts.md#T-04.2.02.03` and `04-invoices-wallet-contracts.md#T-04.2.02.04`: expose submission/approval/confirmation/rejection facts consistently across customer history and staff review.

## Delivered

Customer wallet history offers an inline, keyboard-accessible receipt detail with its ID, recorded deposit day, payer reference, bank name and note. The same semantic timeline component serves customer details and staff review. Recorded submission, requested second approval and final confirmed/rejected decisions use the account timezone. Deposit dates remain calendar days and support Persian display without timezone shifts. Pending review and pending second approval explicitly state that no funds have been applied.

The projection uses the original receipt ledger row and durable decision metadata. New second-approval requests save their request time in the existing transaction and binding. Repeated approval requests retain their original time; financial fingerprints and permission/step-up/settlement behavior stay unchanged. Older missing or malformed timestamps display an explicit missing-time label. No historical timestamps are guessed and no schema migration or audit-log query is introduced.

Customer responses allow only receipt fields, event states/dates and explicitly customer-visible rejection reasons. Raw metadata, storage keys, staff IDs, session IDs, financial reviews and approval bindings are excluded. Decisions must match the current receipt state before their timestamp or visible reason can appear. Separate Completed credits never become extra receipt records, including legacy credits without a source-ID field. The existing scoped keyset query preserves exact IRR strings and PostgreSQL microseconds; inline expansion performs no additional reads.

## Validation and review

- 171 distinct affected unit/integration cases have passing evidence: shared 36, API 52, web 58 and dictionary 25. Repeated checks are not counted again.
- Shared: `pnpm --filter @barghsa/shared exec vitest run src/finance/wallet-bank-receipt-history.test.ts src/finance/wallet-bank-receipt-confirmation.test.ts src/finance/bank-receipt-review.test.ts` — all 36 pass, including legacy credit exclusion, malformed dates, mismatched decisions and private reasons.
- API: the three matching history, receipt-confirmation and customer-wallet HTTP suites pass 52 cases. The final affected history/HTTP rerun verifies the reviewed legacy-credit exclusion. Four dual-approval scenarios verify a persisted timestamp, a fresh detail read and unchanged financial review hashes. The HTTP projection test verifies exact amounts/microseconds, foreign-wallet denial, private-field exclusion, visible rejection and both normal/legacy credit rows.
- Web: transaction history, staff wallet page and staff wallet list suites pass 58 cases. The shared timeline/date display is covered through the real transaction component.
- Dictionary: `pnpm --filter @barghsa/i18n exec vitest run src/messages.test.ts` — 25 pass.
- Production browser: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/wallet-receipt-timeline.spec.ts e2e/staff-wallet-receipt-views.spec.ts --project=chromium --project=mobile-safari` — all 16 pass. Both languages/themes, Axe/contrast, keyboard expansion, mobile bounds, exact amounts, deposit dates, account-timezone events, no extra reads, pagination/filter scope, rejection reasons, missing legacy dates and retained staff review drafts are verified.
- Final `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:suppressed-errors`, `pnpm check:bundle` — pass. All 65 existing size budgets remain unchanged; wallet 253.12 KB / 300 KB and electricity ordering 246.65 KB / 255 KB.
- Strict security: five rule fixtures pass; 1,393 files scanned, zero findings/errors.
- `python3 kanban/scripts/build_backlog.py --check` — 1,355 tasks and 116 traceability entries valid. `git diff --check` — pass.
- Review checked consistent customer/staff projection, decision/state matching, current versus completed events, durable approval timestamps, legacy compatibility, credit exclusion, safe text rendering, exact amounts/cursors and unchanged financial authorization. A test-only unknown JSON type and formatting issues were repaired before publication; initial failures are not represented as passing checks.

## Publication and remaining work

This batch uses direct main publication with local/origin/GitHub SHA, clean tree and exact-commit CI registration read back. Remote CI is pending at publication and is not claimed green. Historical supervisor state, handoffs and completion ledgers are unchanged. Existing CI fast mode and coverage exemption remain unchanged.

Wallet receipt evidence preview/download for customers and broader receipt search/sort remain open. This batch completes the timeline gap; it does not mark broad receipt/history parents fully complete.
