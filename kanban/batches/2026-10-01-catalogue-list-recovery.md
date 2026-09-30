# Catalogue lists and editor recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition for the consultation, electricity, hardware and saving-plan staff catalogues.

Other lists, legacy filter URL serialization and broader search/sort remain open. The all-list parent criterion stays partial. The catalogue API returns arrays without a pagination contract; this batch preserves that API and adds no invented paging controls.

## Behavior and review

The product list loads independently of the selected product, rule references and saving-plan configuration. Opening or cancelling an editor no longer reloads the product list. Failed list reads retain accepted products and have a local Retry that preserves product and price drafts. The existing explicit Refresh still reloads the broader page and resets those drafts.

Detail failures leave the list available and retry the selected product settings without reloading the list or hardware options. Compatible hardware loads only when a saving-plan editor is open; its own retry preserves the plan draft and selected hardware. Saving a plan waits until hardware loading succeeds.

Timezone loading has a separate error and retry. Product editing remains available, while price history and scheduling wait for valid settings. Existing product status, categories, electricity limits, price/version confirmation, agreement and inventory controls remain.

List, detail or hardware permission denial clears retained management data, editor and confirmation. A permission guard prevents another late response from repopulating denied work. Aborted detail responses cannot replace a newer selection. Existing write authorization and step-up confirmation remain unchanged.

Review covers independent request dependencies, retained drafts, denied/stale responses, localized failures, tab keyboard behavior, mobile overflow and accessibility. No API, database, permission-model, dependency, scheduler or CI change is included.

## Validation

Evidence logs: `/tmp/barghsa-catalogue-list-*.log`.

The full web suite passes 1,220 tests in 121 files, including eleven new recovery cases and existing admin boundary, agreement/inventory and confirmation cases. Dictionaries pass all 53 tests. Root build/typecheck/lint/format, contract/suppression checks, all 64 route budgets, backlog validation and diff checks pass. The final edited browser fixture passes targeted lint and typecheck.

Sixteen new recovery scenarios pass in Persian and English across Chromium and mobile Safari. They verify independent detail/hardware/timezone retries, retained products and drafts, disabled saving while hardware is unavailable, exact failed list queries, accessibility, mobile overflow and clearing an open confirmation after permission denial. Eight existing step-up/payload and keyboard-tab regressions also pass, for 24 distinct browser scenarios. Persian mobile Safari price and saving-plan rendering is inspected.

An initial focused failure exposed price controls still visible after timezone failure; the final code hides that section until valid settings are available. An existing browser fixture lacked authenticated staff and reached the application error boundary. It now supplies staff authentication and initializes the persisted locale explicitly. The mixed browser run was stopped after the sixteen new scenarios passed; only the repaired eight existing scenarios were run again. Failed, interrupted and repeated scenarios are excluded from passing totals.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/i18n test`
- Initial focused verification: `pnpm --filter @barghsa/web exec vitest run src/pages/catalogue-list-recovery.test.tsx src/pages/admin-boundaries.test.tsx`; the final full web suite covers those cases after the timezone fix.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test catalogue-list-recovery.spec.ts catalogue.spec.ts --project=chromium --project=mobile-safari --workers=2`
- Final related verification: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test catalogue.spec.ts --project=chromium --project=mobile-safari --workers=2`
- Targeted `pnpm exec eslint` and `pnpm exec prettier --check` cover the final edited browser and progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding solar staff queue batch is published as `5cfb0bb8148a96d89b9e804b74ad2f1f0791f68a`; CI run `36785087969` passes all five gates under the existing temporary fast mode. The combined-coverage success is an exemption, not measured coverage.

This reviewed catalogue batch is committed and pushed directly to main after related checks. The remote commit and CI are verified after publication.
