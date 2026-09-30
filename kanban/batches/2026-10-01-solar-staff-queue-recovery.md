# Solar staff queue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition for pending solar files, the solar document request queue and the postal/final review queue across two staff pages.

Other product/staff lists, URL serialization of legacy filters and broader search/sort remain open. The all-list parent criterion stays partial. This batch changes queue recovery, not the solar construction workflow or its business rules.

## Behavior and review

Loading another page retains accepted rows. Each queue retries its exact failed cursor independently, preserving the selected request, staff explanation, document preview and guidance draft. Request detail and guidance failures have separate retries. Permission-denied queues discard retained rows, selection and confirmation state.

Document-set, postal and final decision previews are bound to the current selection generation. A delayed response cannot open a confirmation after the reviewer selects another request or loses queue permission. Existing review hashes, write confirmations and contract creation remain intact.

Document detail uses existing localized request, document and staff-review labels. Successful document actions clear prior validation errors. Clicking an already selected request with failed detail leaves its Retry button available.

Review covers request cancellation, independent dependencies, exact cursor retry, draft preservation, permission failure and delayed confirmation. Persian mobile rendering is inspected. No API, database, permission-model, dependency, scheduler or CI change is included.

## Validation

Evidence logs: `/tmp/barghsa-solar-list-*.log`.

The full web suite passes 1,208 tests before the final review adjustments. All 13 focused cases pass on the final code, including ten new recovery/regression cases and three existing solar queue cases. Dictionary tests pass all 53 cases. Final root build/typecheck, targeted lint and all 64 route budgets pass. Root lint/format, contract/suppression checks, backlog validation and diff checks also pass during the batch.

Twelve new bilingual recovery scenarios and eight existing solar journey/final rejection scenarios pass across Chromium and mobile Safari, for 20 distinct browser scenarios. The four request-queue scenarios run again after the final fixes and pass; repeated runs are excluded from the total. They verify detail-only retry, selected-row retry availability, localized status labels, retained notes/guidance, exact cursor recovery, disabled pending pagination, permission denial and accessibility. Updated Persian mobile Safari document detail is visually inspected.

Existing solar browser fixtures now initialize English explicitly instead of clicking a header language button unavailable in the mobile layout. The new recovery scenarios cover both Persian and English.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/pages/solar-list-recovery.test.tsx src/pages/admin-solar-queues.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test solar-staff-list-recovery.spec.ts solar-journey.spec.ts solar-final-rejection.spec.ts --project=chromium --project=mobile-safari --workers=2`
- Final browser verification runs `solar-staff-list-recovery.spec.ts --grep 'solar requests'` in both projects, retaining the other passing scenarios from the preceding run.
- Targeted `pnpm exec eslint` and `pnpm exec prettier --check` cover the final edited source, browser and progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding business queue batch is published as `614e6ef4988e148d7ddc84d46f902247be7207a4`; CI run `36783876844` passes all five gates under the existing temporary fast mode. Its combined-coverage success is an exemption, not measured coverage.

This batch is published as `5cfb0bb8148a96d89b9e804b74ad2f1f0791f68a`; CI run `36785087969` passes all five gates under the existing temporary fast mode. The combined-coverage success remains an exemption, not measured coverage.
