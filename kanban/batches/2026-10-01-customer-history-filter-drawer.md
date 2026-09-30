# Customer history filter drawer — October 1, 2026

## Kanban scope

- `07-ui-ux-design.md#T-07.18.01.03`: complete the shared ListFilterPanel drawer and combined Apply behavior. The existing count, chips and Clear all remain available outside the drawer.
- Adopt the drawer for electricity orders, saving orders, solar requests, consultations, invoices, contracts and bank receipts. Shared text, single-select, multi-select, date, number and status controls compose in one transaction.
- The broader ListPage compound component and staff/all-product list adoption remain open. This batch does not mark those parent criteria complete.

## Behavior and review

Filters open a named, keyboard-accessible Base UI Sheet with an independently scrolling body and persistent Apply, Cancel and Clear all actions. It fills narrow screens and respects Persian direction; the close control has a 44px target. Applied counts and removable chips remain above the list.

Selections, sort changes and raw text/date/amount edits stay local until Apply. The drawer validates every pending field before committing any changes, includes the final keystroke, then performs one URL navigation. Invalid date or exact integer ranges keep the drawer open and focus the invalid field. Legacy standalone controls retain their existing immediate/debounced behavior.

Cancel, Escape and reopening discard pending edits. Browser navigation and profile-context changes also reset raw drafts, even when another applied field changes while search stays identical. Untouched custom UTC bounds retain their exact values; unavailable timezone controls preserve the existing range while other fields can apply. Review and calendar tests fixed an existing edge case where selecting the same preset after a custom edit could retain the custom end day.

Existing history scopes, view preferences, contract detail selection and consultation form state remain. Applied changes reset cursor pages, cancel old requests and support Back/Forward and reload. Clear all remains one deliberate reset. There are no backend, migration, dependency, CI or bundle-budget changes.

## Validation

Evidence logs: `/tmp/barghsa-filter-drawer-*.log`.

Build, root typecheck, lint, contract consistency, suppression checks and all 64 route/interaction budgets pass. The final web suite passes 1,184 tests. Four focused component cases, 64 UI cases and 53 dictionary cases pass. Forty-two distinct bilingual history flows pass across Chromium, Firefox and mobile Safari, including the four repaired Chromium scenarios. Persian mobile Safari rendering is inspected. Ten related Chromium table/card flows also pass, bringing the distinct browser coverage to 52 scenarios.

The initial failed test runs are not counted as passes. Modal tests were updated for hidden background controls and completed opening transitions. The invoice fixture now holds only the first intended request, allowing Back to complete. Custom calendar tests validate the whole-draft rejection and the repaired preset transition.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:bundle`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/ui test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/components/HistoryFilterDrawer.test.tsx src/components/HistoryFilterPanel.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test customer-history-filters.spec.ts customer-invoice-filters.spec.ts customer-contract-filters.spec.ts customer-bank-receipt-history.spec.ts --project=chromium --workers=1`
- Repaired Chromium scenarios: `customer-history-filters.spec.ts customer-invoice-filters.spec.ts --project=chromium --workers=1 --grep 'saving history|invoice filters'`
- Cross-browser scenarios: the four history/filter specifications above with `--project=firefox --project=mobile-safari --workers=2`
- Related views: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test customer-financial-history-views.spec.ts customer-service-history-views.spec.ts --project=chromium --workers=2`
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding mobile topbar/account batch is published as `2077edca313db7fefc77eb581ec69ac499c6ec15`; CI run `36774899041` passes all five gates under the existing temporary fast mode. This reviewed batch is published directly to main after all related local checks. Its exact remote SHA and CI are verified after push; no remote pass is claimed here.
