# Customer product browsing and recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition for electricity products, saving plans and available consultations.

Other lists, legacy filter URL serialization and broader search/sort remain open. The all-list parent criterion stays partial. This batch preserves catalogue APIs, ordering prerequisites and existing history navigation.

## Behavior and review

Electricity browsing keeps its heading and order/history navigation available during initial loading and failures. Electricity products and saving plans have explicit Refresh and local Retry controls. Later loading or transient failures retain accepted cards; saving agreement expansion remains open across retries. Permission denial discards retained products. The existing four-product electricity response validator still rejects malformed responses.

Consultation profile loading has a local retry. Products and request history load independently once the active profile is available. A product failure no longer hides existing requests. Product retry reloads only the active profile's catalogue and preserves the selected consultation, confirmation and submission key when that product remains available.

New requests wait while the catalogue is loading, failed or denied. The submit handler enforces that condition as well as the button. A refreshed catalogue that removes the chosen product clears selection and confirmation. Product permission denial clears the selection while leaving independently authorized request history available.

Product controls and failures have Persian/English labels. Saving plan/equipment fields wrap on mobile. The existing consultation history browser test now scopes its history content to the named history section, since products and history each have a ListPage.

Review covers independent resources, draft/selection preservation, stale selection, submission idempotency, permission denial, cancellation, accessibility and mobile rendering. No API, database, permission-model, dependency, scheduler or CI change is included.

## Validation

Evidence logs: `/tmp/barghsa-customer-browse-*.log`.

The full web suite passes 1,227 tests in 122 files, including seven new recovery cases. All twelve focused cases pass, including the existing electricity and saving catalogue tests. Dictionaries pass all 53 tests. Root build/typecheck/lint/format, contract/suppression checks, all 64 route budgets, backlog validation and diff checks pass. The final edited browser fixture passes targeted lint, formatting and typecheck.

Twelve new bilingual recovery scenarios pass across Chromium and mobile Safari. Four existing consultation history recovery scenarios and six existing electricity, saving and consultation customer/staff journeys also pass, for 22 distinct browser scenarios. Persian mobile Safari rendering is inspected for all three pages.

The initial browser run passes 21 cases. Its mobile Safari simple-electricity journey times out looking for the old header language button. That English journey fixture now initializes the persisted locale explicitly; its focused Safari rerun passes. No production change is required for that fixture repair. Failed and repeated cases are excluded from passing totals.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/pages/customer-browse-recovery.test.tsx src/pages/electricity-catalogue.test.tsx src/pages/saving-catalogue.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test customer-browse-recovery.spec.ts customer-list-recovery.spec.ts consultation-journey.spec.ts saving-journey.spec.ts electricity-simple-journey.spec.ts --grep 'customer (electricity|saving|consultation) browsing|customer consultation moves|customer saves a saving order|simple electricity order moves|consultation history retries' --project=chromium --project=mobile-safari --workers=2`
- Final fixture verification: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test electricity-simple-journey.spec.ts --project=mobile-safari --workers=1`
- Targeted `pnpm exec eslint` and `pnpm exec prettier --check` cover the final edited browser and progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding catalogue staff batch is published as `75b3d0960efdf9ebe39b6ecd631f0e04633218b0`; CI run `36786063541` passes all five gates under the existing temporary fast mode. The combined-coverage success is an exemption, not measured coverage.

This customer browsing batch is committed and pushed directly to main after review and related checks. The remote commit and CI are verified after publication.
