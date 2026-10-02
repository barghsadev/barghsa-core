# Order and settings address selection, October 2, 2026

## Scope and result

This related adoption batch extends `07-ui-ux-design.md#T-07.10.02.04` to the remaining five address flows identified through geography catalogue usage: simple electricity checkout, electricity order correction, saving checkout, customer address settings and customer profile settings. Together with the preceding onboarding/CRM batch, eleven live city fields now use the shared `DependentSelect` and validated `useGeographyOptions` hook. Separate FormStep, dynamic-field-array and other form-system criteria remain open.

Province changes clear the child selection. Missing parents, loading, failed reads and invalid catalogue responses disable city choices. The shared hook cancels obsolete requests and validates unique IDs, localized names and the requested province. Retry preserves unrelated fields and restored city IDs. The hook's existing response validation is extracted into `loadGeographyOptions` so the simple electricity page can also reuse it for display-only saved-address names.

Changed locations must belong to the current catalogue before saving or reviewing. Electricity correction preserves the ability to review an unchanged historical address when geography is unavailable; its saved city appears only under its original province. Profile settings retain the existing confirmation and saved inactive-city behavior. Saving additionally verifies that the address acknowledgement matches both requested province and city, preserving the form when a response names another city. Existing draft, version, quotation, agreement and submission protections remain.

Simple electricity checkout moves into `SimpleElectricityOrderPage` behind the existing route's lazy component boundary. The route retains its search validation and maintenance guard. This keeps form code out of the application bootstrap and restores bundle headroom without changing Vite configuration or raising any limit. No API, migration or dependency is added.

## Review and validation

Source review checks parent changes, response validation, request cancellation, retry retention, saved locations, write guards and acknowledgement matching. The page relocation is compared against the previous route implementation with import paths normalized; its remaining changes are the selector/hook adoption described above.

- **33 web cases across five files pass**, covering geography responses/retry, simple ordering, electricity detail/revision behavior and saving ordering. New revision cases verify that an invalid city catalogue blocks a changed location and that geography failure does not prevent review of unchanged historical terms.
- **All 88 related production browser scenarios pass** across Chromium/mobile Safari. The selected scope covers customer profile/address read and write recovery, simple/advanced electricity draft history and departure, saving draft/consent/submission recovery, final section editing and customer default-profile behavior. It also includes the complete simple electricity quote → payment → staff review → contract activation journey in both browsers. Both languages are exercised where the existing scenarios provide them. Scoped Axe, mobile bounds and Persian mobile address rendering are verified.
- The eight new electricity/saving geography recovery executions also pass in an earlier focused run. An initial simple-order test used the settings form's Save label; its locator now uses the actual localized Save and use control. No product behavior or assertion is weakened.
- Root build passes **seven tasks** and typecheck **11**. Root lint, formatting, OpenAPI, suppressed-error and diff checks pass. Backlog validation covers **1,355 tasks and 116 traceability entries**.
- All **73 unchanged bundle limits pass**. Dashboard loading is **290.57 KB / 300 KB** and electricity ordering **245.18 KB / 255 KB**, down from 299.81 KB and 254.69 KB in the preceding batch.
- Strict security scans **1,498 files**, with zero findings/errors and all five rule fixtures passing. No unrelated full repository test suite, database/API suite or unchanged dictionary suite is claimed.

Unit command: `pnpm --filter @barghsa/web test src/pages/electricity-order.test.tsx src/pages/electricity-order-details.test.tsx src/pages/electricity-revision-geography.test.tsx src/pages/saving-order.test.tsx src/hooks/useGeographyOptions.test.tsx`.

Browser command: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e customer-address-selection.spec.ts electricity-wizard-navigation.spec.ts service-wizard-navigation.spec.ts profile-switch.spec.ts electricity-simple-journey.spec.ts --grep "simple|advanced|saving|customer|profile settings changes" --project=chromium --project=mobile-safari --workers=2`. The release build remains unchanged throughout that run.

## Deployment and publication

Deploy the frontend with the existing API. Existing drafts, historical saved locations and retained version safeguards remain compatible.

Publication uses direct main through Git/GitHub CLI, with local/remote/GitHub SHA agreement, a clean checkout and exact-commit CI registration read back after pushing. New remote checks remain pending until GitHub completes them. The preceding selector commit `974bd5350af6645e5ab28af1cdba9c7921fcb7ba` passes all five CI jobs in [run37041276469](https://github.com/barghsadev/barghsa-core/actions/runs/37041276469); the existing fast-mode coverage exemption is unchanged. No PR, scheduler, external supervisor state/handoff, historical `kanban/loop-state.json`, or generated completion/event history is changed.
