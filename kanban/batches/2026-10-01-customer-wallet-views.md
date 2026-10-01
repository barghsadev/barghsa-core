# Customer wallet transaction table and card views

Date: October 1, 2026. Manual batch under the user's direct-main workflow.

## Task scope

- `07-ui-ux-design.md#T-07.18.01.05` and `07-ui-ux-design.md#T-07.18.01.06`: adopt the shared view toggle and list composition for customer wallet history.
- `07-ui-ux-design.md#T-07.18.03.03`, `07-ui-ux-design.md#T-07.26.01.03`, `04-invoices-wallet-contracts.md#T-04.3.02.03` and `04-invoices-wallet-contracts.md#T-04.3.02.04`: expose public receipt metadata alongside wallet rows and retain exact transaction/state descriptions and receipt details. Broad all-list parent tasks remain partial.

## Delivered

Wallet history offers shared table/card controls. Before an explicit choice it follows desktop table and mobile card defaults. The existing account-scoped preference hook persists this history independently of other accounts and lists, and remains usable when storage is unavailable. Both views render one accepted page without another history or evidence read when toggled. Search, filters, cursor, accepted rows and failed-page Retry retain their existing scope. The table uses the shared captioned, horizontally scrollable history table; cards compose existing Card and Badge components.

Both layouts expose exact signed amounts, state/type/icon, transaction ID, localized submission time, public description/reference, invoice link and original receipt bank/deposit/transfer metadata. Date-only deposits stay on their recorded calendar day. Public receipt disclosures preserve their open state across layouts, discard absent IDs after a new page and reset with profile/query ownership. Private preview remains lazy; changing layouts closes a mounted preview rather than refetching it automatically. Existing native original-file and preview recovery paths remain intact.

Review also fixes misleading type-only descriptions: unfinished top-ups no longer say funds were added, and failed payments do not imply invoice settlement. Pending original receipts use the existing review/second-review descriptions; confirmed receipt rows say Receipt confirmed while the separate Completed credit retains its signed green posting. Other unfinished transactions use existing localized state descriptions. No API, database, posting or financial review behavior changes.

## Validation and review

- 113 distinct affected unit/dictionary cases pass: web 60 and dictionaries 53. Repeated runs are excluded.
- `pnpm --filter @barghsa/web test src/components/WalletTransactionRecords.test.tsx src/components/WalletTransactionList.test.tsx src/pages/WalletPage.test.tsx src/hooks/useListView.test.tsx` passes 60 cases. They check identical exact metadata, escaped public text, invoice links, receipt-only detail projection, actual signed colors, state-appropriate descriptions, recorded Persian dates, disclosure preservation/pruning, desktop defaults, account/history preference isolation, storage recovery, existing profile/query guards and unchanged pagination Retry. `pnpm --filter @barghsa/i18n test` passes 53 cases.
- `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e wallet-receipt-timeline.spec.ts wallet-invoice-payment.spec.ts --project=chromium --project=mobile-safari --workers=2 --max-failures=1` passes all 28 distinct production scenarios. The final eight-case wallet-history file rerun passes after the description correction. Actual responsive defaults, preference reload, table/card changes without extra reads, kept disclosures, exact filters/cursors/Retry, gateway/invoice returns, financial confirmation and ambiguous retry, keyboard scrolling, both languages/themes, Axe/contrast and mobile bounds have passing evidence. Persian dark mobile cards and table viewport were visually inspected.
- Root build/types/lint/format, contract/suppression and all 66 unchanged route/interaction budgets pass. Wallet is 273.14 KB / 300 KB; electricity ordering is 247.65 KB / 255 KB. Backlog remains 1,355 tasks and 116 traceability entries; diff whitespace passes. Strict security passes five fixtures and scans 1,404 files with zero findings/errors.
- Review checked accepted-page ownership, per-account preferences, exact signed/public metadata, accessible table/card structure, bounded disclosure state, lazy evidence, query independence and financial text. One test formatter's return type was corrected from an input union to a string. An initial command named a nonexistent standalone HistoryTable test; the passing four actual suites are listed above. The production wallet build stays within its existing budget. Failed/repeated invocations are excluded from passing counts.

## Publication and remaining work

Publish by conventional direct-main commit; verify local/origin/GitHub SHA, clean tree and exact-commit CI registration after push. Remote CI is pending at publication; no remote success is claimed. Historical supervisor state, handoffs and completion ledgers remain unchanged, as do existing CI fast mode and coverage exemption.

Customer wallet table/card adoption is delivered around its query/detail flow. Other unfinished lists and product requirements remain open; broad parent tasks are not marked complete by this batch.
