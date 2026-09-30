# Staff business queues and independent recovery — October 1, 2026

## Kanban scope

- `07-ui-ux-design.md#T-07.18.01.06`: adopt the shared ListPage composition for electricity review/conversation queues, saving review/fulfillment queues and consultation staff work.
- Existing domain detail and financial confirmation flows remain outside queue loading and error states.
- Other product/staff list adoption, serialization of legacy staff filters and broader search/sort remain open. The all-list parent criterion stays partial.

## Behavior and review

Loading another page retains accepted rows. A local queue retry repeats the failed cursor and filters without reloading the selected record, clearing a staff explanation or interrupting its review. Detail failures have their own retry and leave the queue available. Explicit Refresh retains its existing wider refresh behavior.

Consultation team loading has a separate error and retry. A team failure no longer masks successful queue/detail data. Fee, paid-fee and paid-resolution review responses are bound to the current selection generation; delayed responses cannot reopen a confirmation after changing requests or losing queue permission. Permission-denied queues discard retained rows, selection and confirmation state.

Electricity lookup and queue controls wrap on mobile. Its product table uses the existing horizontal ScrollArea, with a named region and verified keyboard scrolling in Safari. The pages reuse Persian/English strings; consultation team/detail/permission errors have matching new dictionary entries.

Review checks independent request dependencies, exact cursor retry, retained drafts, request cancellation, permission failures, financial confirmation binding, mobile overflow and accessibility. No API, database, permission-model, dependency, scheduler or CI change is included.

## Validation

Evidence logs: `/tmp/barghsa-staff-business-list-*.log`.

The full web suite passes 1,199 tests, including eight new recovery cases; dictionaries pass all 53 cases. After the final electricity accessibility adjustment, all 19 affected component cases pass, including existing saving/electricity/consultation financial confirmation tests. Build and root typecheck pass on the final production code. Root lint/format checks pass, and the final edited source/browser files pass targeted lint and formatting. Contract/suppression checks, all 64 route budgets, backlog validation and diff checks pass.

Twelve new bilingual recovery scenarios pass across Chromium and mobile Safari in the final runs. Six existing saving/consultation customer-to-staff journey and fulfillment-prerequisite regressions also pass, for 18 distinct browser scenarios. Tests cover detail-only retry, exact failed queue queries, retained drafts, disabled pending pagination, permission denial, accessibility and keyboard scrolling. Persian mobile rendering is inspected for all three pages.

Initial failures exposed an inaccessible electricity scroll region and outdated browser fixtures. The scroll region is fixed. Existing journey tests now select Cards when asserting card headings, use the current account-menu language control on mobile, and provide authenticated staff/timezone fixtures. Development Strict Mode's extra initial fetch is accounted for by asserting that detail retry adds no queue request. Failed runs and repeated passing scenarios are excluded from totals.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/pages/staff-business-list-recovery.test.tsx src/pages/admin-electricity-orders.test.tsx src/pages/admin-saving-orders.test.tsx src/pages/admin-consultations-queue.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test staff-business-list-recovery.spec.ts --project=chromium --project=mobile-safari --workers=2`
- After the electricity fix, its two locale cases run again in both projects alongside related journeys; passing saving/consultation recovery cases are retained from the preceding run.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test saving-journey.spec.ts consultation-journey.spec.ts saving-fulfillment-prerequisites.spec.ts --project=chromium --project=mobile-safari --workers=2`
- Targeted `pnpm exec eslint` and `pnpm exec prettier --check` cover final edited source, browser and progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

This batch is published as `614e6ef4988e148d7ddc84d46f902247be7207a4`; CI run `36783876844` passes all five gates under the existing temporary fast mode. The combined-coverage gate remains an exemption, not measured coverage. The preceding staff-finance batch is published as `7f54512d6c69e3a43783594ad0e5518065324bde`, with all five gates passing in CI run `36782061024`.
