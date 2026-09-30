# Customer bank receipt history and searchable multi-select filters

Canonical work: finishes the missing MultiSelectFilter control in `07-ui-ux-design.md#T-07.18.02.03`, alongside customer receipt-list adoption of `07-ui-ux-design.md#T-07.18.03.03`, shared table/card views (`07-ui-ux-design.md#T-07.18.01.05`) and URL filter persistence. The full receipt detail pattern, ListPage framework, filter drawer/popover with combined Apply, other lists and staff adoption remain open.

The shared controlled MultiSelectFilter uses the existing Base UI combobox, searchable translated options, removable selection chips and conditional Clear all. Searching does not apply a status. Selection stays open for adding multiple choices, external selection changes clear stale search text, and clearing returns focus to the input. The input participates in chip keyboard navigation; options and chip removal have mobile touch targets. No dependency was added.

Bank receipts now support table/card views and account/history-scoped preference persistence. Both presentations retain receipt ID, invoice reference, exact IRR amount, bank, verification state, deposit date and submission time. Receipt links retain the matching invoice and receipt fragment. Deposit dates remain Gregorian date-only values formatted in UTC; submission times retain account timezone/calendar formatting. Changing views retains loaded pages without refetching.

Selected statuses persist in the URL and survive reload and Back. Legacy `state` URLs initialize the new selection. The API still accepts the legacy single `state` query, adds bounded canonical `statuses` CSV, rejects malformed/unknown/repeated query parameters and ambiguous combinations, and documents the new query in the OpenAPI snapshot. PostgreSQL applies the selected states before pagination while retaining active-profile authorization, matching invoice ownership, draft exclusion, timestamp/UUID ordering and six-digit microsecond cursor precision. Filter changes reset pages and abort initial/older requests; late responses cannot append stale results.

Review checked filter validation and normalization, legacy compatibility, profile-scoped SQL, exact cursor forwarding, request cancellation and duplicate prevention, controlled combobox selections, keyboard interaction, localized accessible removal actions, view preferences, invoice fragments, dates and amounts. The browser tests caught a stale-query problem after the first selection; keeping the multi-select open while selecting resolved it. Persian mobile rendering was inspected.

Validation:

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:contract` and all 64 `pnpm check:bundle` budgets pass.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/invoice/customer-invoice.controller.test.ts src/invoice/customer-invoice-read-http.integration.test.ts`: 32 passing unit and real PostgreSQL/HTTP cases, including microsecond pagination, combined status filtering, isolation and malformed input.
- `pnpm --filter @barghsa/web test`: 1,169 passing. The four receipt page cases pass again against the final shared control, including late aborted-page response rejection. `pnpm --filter @barghsa/i18n test`: 53 passing.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web e2e customer-bank-receipt-history.spec.ts --project=chromium --workers=1`: two passing flows. Firefox, WebKit, Android and iPhone: eight passing flows. These ten scenarios verify exact values, date-only formatting, pagination, selection/search/removal/reset, reload/Back, legacy URLs, view persistence, accessibility and mobile overflow.
- Diff whitespace and `python3 kanban/scripts/build_backlog.py --check` pass (1,355 tasks and 116 traceability entries).

The preceding service-history batch's [GitHub CI](https://github.com/barghsadev/barghsa-core/actions/runs/36754102479) completed successfully. This batch is pushed directly to main; its new remote CI is checked after push. CI retains the previously requested temporary fast mode, so no new full coverage measurement is claimed. Scheduler, historical supervisor state and generated queue/ledger remain unchanged.
