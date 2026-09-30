# Customer list composition and recovery — October 1, 2026

## Kanban scope

- `07-ui-ux-design.md#T-07.18.01.02`: shared responsive `ListToolbar` composition for search, sort, filters and create/view actions. Standalone search keeps its 300ms debounce; customer drawer fields retain the combined Apply transaction.
- `07-ui-ux-design.md#T-07.18.01.06`: shared `ListPage` compound component combining toolbar, existing filter panel, asynchronous table/card content and cursor or offset pagination. Adopted by all seven customer histories: electricity, saving, solar, consultation, invoice, contract and bank receipt.
- Staff contract results also use the shared content and pagination through their existing workspace. Staff filters and permission boundaries remain intact. Other staff/product lists still need adoption; the all-list parent criterion remains open.

## Behavior and review

Initial loading, error and empty states replace content. Subsequent page loads and errors keep accepted rows mounted with a local loading/error message, allowing a retry of the failed cursor without clearing earlier pages or applied filters. Saving histories gain a retry action. Contract retry uses a separate revision from Refresh so it does not reset the list or selected detail. Bank-receipt retry targets the failed page and preserves its exact timestamp cursor. Consultation form selections survive history retries.

Named pagination disables duplicate loads while busy, keeps its action label stable and disappears when exhausted. The toolbar wraps on narrow screens and uses native controls. Persian and English labels, RTL layout, applied chips, combined filter Apply, query navigation, table/card preferences, profile scope and stale-request cancellation remain supported. Creation actions stay with the existing business entry points.

Review checked retry effect dependencies against cursor reset scopes, content mounting, shared contract details, exact amounts and timestamps, and filter transaction behavior. No API, database, dependency, CI or budget changes are included.

## Validation

Evidence logs: `/tmp/barghsa-list-page-*.log`.

- Root build and typecheck pass.
- Web: 1,184 tests pass; shared UI: 67 tests pass, including three new composition/mounting/debounce cases; dictionaries: 53 tests pass.
- New recovery scenarios: 14 Chromium and 14 mobile Safari cases pass across seven histories and both languages. They cover initial failure, local retry, retained rows while loading/failing, disabled duplicate loads, identical retry queries, exact bank-receipt cursors, consultation form state, accessibility and mobile overflow.
- Thirty related Chromium filter/view and customer/staff contract regression scenarios pass, bringing the total to 58 distinct browser cases.
- Root lint, contract consistency, suppression checks and all 64 route/interaction budgets pass. Root format, backlog validation (1,355 tasks and 116 traceability entries) and diff checks pass.
- Persian mobile recovery rendering is inspected.

The first recovery run exposed automatic HTTP retry behavior in the test fixture. The corrected fixture holds failure through automatic attempts and releases success only for the user retry. Failed runs are excluded from the passing totals.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:bundle`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/ui test`, `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test e2e/customer-list-recovery.spec.ts --project=chromium --workers=2`
- The recovery specification also runs with `--project=mobile-safari --workers=2`.
- Chromium regressions: `customer-history-filters.spec.ts customer-invoice-filters.spec.ts customer-contract-filters.spec.ts customer-bank-receipt-history.spec.ts customer-financial-history-views.spec.ts customer-service-history-views.spec.ts contracts.spec.ts contract-context.spec.ts --project=chromium --workers=2`
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding filter-drawer batch is published as `6caa6d4d4efefe40eb725f665afcf34f2b0d59cc`; CI run `36778092189` passes all five gates under the existing temporary fast mode. The coverage gate is an exemption, not measured combined coverage. This batch is published directly to main as `7dfd27f6bb2cc70f692e5eb340e1fce2e50216c0`, with no PR. CI run `36780246336` passes all five gates under the existing temporary fast mode.
