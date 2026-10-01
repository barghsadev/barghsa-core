# Customer receipt search, sorting and filters

Date: October 1, 2026. Manual batch under the user's direct-main workflow.

## Task scope

- `07-ui-ux-design.md#T-07.18.03.03` and `04-invoices-wallet-contracts.md#T-04.3.02.03`: finish customer invoice-receipt list discovery around the existing detail/evidence flow.
- `07-ui-ux-design.md#T-07.18.01.02`, `07-ui-ux-design.md#T-07.18.01.04`, `07-ui-ux-design.md#T-07.18.02.02`, `07-ui-ux-design.md#T-07.18.02.03`, `07-ui-ux-design.md#T-07.18.02.04` and `07-ui-ux-design.md#T-07.18.02.05`: apply shared search, sort, date/amount controls, atomic filter drafts, URL persistence and removable chips to this list. These broad all-list parents remain partial.

## Delivered

Customer invoice receipts now support literal search across receipt ID, invoice ID, bank name and payer reference. Status selections, half-open submission date ranges and inclusive exact IRR amount bounds combine on the server. The two allowlisted orders are newest and oldest submission first. The existing timestamp/UUID cursor works in both directions and retains PostgreSQL microseconds; results stay bounded to 25 rows. All predicates remain inside the existing authorized active-profile read, exclude draft invoices and project only customer-safe fields. Query values are bound parameters; sort direction is selected from fixed constants. No financial writes, database migrations, public attachment keys or extra per-row reads are introduced.

The customer page reuses existing shared controls and drawer drafts. Apply commits search, sort, dates, amounts and statuses in one navigation. Cancel discards edits. Reload and Back/Forward restore applied selections. Clear/removal retain the selected order. Large amounts remain strings through the router's string-preserving URL serialization and API requests. Legacy `state` links still select the equivalent status. Ascending pagination says Show newer receipts. Table/card toggles keep their existing account preference and do not fetch again.

Receipt data carries its profile/query scope. Changed scope hides old rows immediately and aborts obsolete reads; late results cannot repopulate another scope. Pagination failures retain accepted rows and retry the same criteria/cursor. Filter controls retain their identity so clearing filters restores keyboard focus. Both languages and themes use existing presentation, with new translated search guidance and ascending-page labels. The OpenAPI contract documents all new parameters and the selected-order page semantics.

## Validation and review

- 114 distinct affected unit/integration/dictionary cases have passing evidence: API 76, web 13 and dictionary 25. Repeated cases are excluded.
- API controller/service suites supply 60 passing cases. Final `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/invoice/customer-invoice-read-http.integration.test.ts` passes 16 real PostgreSQL HTTP cases. Literal `%`, `_` and backslashes, Persian/case-insensitive search, public IDs/references, foreign profiles/draft exclusion, exact int8 bounds above JavaScript's safe integer, half-open dates, combined criteria and both cursor directions at tied microseconds are verified. Invalid/unknown/ambiguous query fields are rejected before service reads.
- Web API adapter, filter panel and receipt page supply 13 passing cases; the final six-case receipt page rerun verifies scoped aborts, unchanged-query read counts, ascending labels, exact criteria and pagination recovery. The 25 dictionary checks verify matching language keys/placeholders.
- Final `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/customer-bank-receipt-history.spec.ts --project=chromium --project=mobile-safari` passes all eight browser scenarios across both languages and themes. It checks existing columns/exact amounts/deposit dates, account views, legacy links, status selection, search/sort/date/amount edits in one Apply, Cancel, initial criteria through reload, native cursor recovery, chips, Clear/Back, focus, Axe/contrast and mobile bounds. Persian dark-mode mobile rendering was inspected.
- Build, types, root lint plus final affected-file lint, format, contract and suppression checks pass. All 65 unchanged release budgets pass; wallet 254.03 KB / 300 KB and electricity ordering 246.76 KB / 255 KB. Backlog remains 1,355 tasks and 116 traceability entries; diff whitespace passes.
- Strict security passes five fixtures and scans 1,395 files with zero findings/errors.
- Review found and fixed loss of filter-trigger focus caused by replacing the entire page on scope changes. Only scoped receipt data now changes. Initial API failures were invalid test fixtures for receipt state/attachment uniqueness and a PostgreSQL parameter cast; browser fixtures now use the router's actual string-preserving URL serialization and scope localized Retry to receipt content. A later type run encountered missing cached shared declarations; a forced type run restores them and passes all 11 tasks. Failed/repeated invocations are not reported as passing.
- Review checked bound literal search, fixed sort directions, cursor comparison/order/tie consistency, exact amounts, inclusive/exclusive date boundaries, active-profile and draft isolation, allowlisted output, current scope/abort handling, retained pagination recovery, drawer transaction behavior, keyboard focus, translations and contract consistency.

## Publication and remaining work

This batch is committed and pushed directly to main, with local/origin/GitHub SHA, clean tree and exact-commit CI registration read back. Remote CI remains pending at publication; no remote success is claimed. Historical supervisor state, handoffs and completion ledgers remain unchanged, as do the existing CI fast mode and coverage exemption.

The customer invoice-receipt list now has server search, submission order, date/amount/status filtering and URL persistence around its existing details/evidence. Staff receipt query adoption and broader unfinished product requirements remain open. Broad parent tasks are not marked complete by this batch.
