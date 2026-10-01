# CRM correction queue URLs, October 1, 2026

## Scope and behavior

This related batch extends `07-ui-ux-design.md#T-07.18.02.04` across the global and profile-filtered `/admin/crm/corrections` queue. Status and numeric pages restore from direct links, reload and Back/Forward. Status changes reset the page; shrinking queues replace invalid pages with the last valid page. Parsing retains only supported status, page, profile UUID and identity-field selections. Private requested values, reasons, reviewer notes, evidence and passwords are excluded from generated links and API queue criteria.

Failed page reads retain accepted rows and retry the exact offset, but old-page rows cannot start a review. Changing queue pages or criteria clears selected review details, notes and confirmation. Independent profile correction drafts and chosen files remain. Generation checks reject obsolete review receipts and close callbacks; acknowledged creation refreshes the current queue rather than its captured old page. Aborted or late old reads cannot repair a newer history page. Standalone consumers retain local status/paging controls. No API, schema, dictionary or dependency change is required.

## Review

The route, queue/detail/profile resources and acknowledgement handling were reviewed against the existing API's status/profile/20-row offset contract. An old test asserted that review work could survive navigation off its case's page; the regression now verifies disposal while retaining accepted rows and exact retry. Independent creation drafts remain covered.

Release budgets initially caught the shared bootstrap putting the electricity ordering route just above its existing 255 KB limit. The adapter stays in the lazy correction page, UUID validation imports the small primitive directly, and shared list-query serialization reuses one serializer for proposed and accepted state. The latter removes duplicate code while preserving validation, default omission, pagination reset, prefixes and unrelated route context. Parser/binding regressions cover the shared change. All final budgets pass without changing limits. One parallel unit run briefly failed to resolve shared promotions while dependency tasks were active; the isolated file and the final affected suite pass after those tasks finish. No assertion or validation is relaxed.

## Validation

- From `apps/web`, `pnpm exec vitest run src/hooks/useListQuery.test.tsx src/lib/*query.test.ts src/pages/crm-recovery.test.tsx src/pages/staff-order-list-query.test.tsx src/pages/support-list-query.test.tsx src/components/record-list-query.test.tsx` passes all 306 cases across 20 files, verifying shared serialization, public normalizers, bound navigation and existing CRM recovery. The initial CRM-only suite passes 57 cases; repeated cases are not counted as additional coverage.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/crm-correction-query.spec.ts e2e/crm-corrections.spec.ts e2e/crm-recovery.spec.ts --grep "correction" --project=chromium --project=mobile-safari --workers=2` passes all 40 distinct scenarios. The final production build rerun targets only the new query file and passes eight scenarios. Both languages, actual light/dark themes, mobile bounds, Axe, history during a pending write, exact retry, profile draft/file retention and clipped-page recovery are verified. Both Persian mobile views are visually inspected. Existing creation/review tests also verify password confirmation, fixed evidence, keyboard recovery, denial and matching acknowledgements.
- Root build passes seven tasks and types pass 11. Root lint plus final affected-file lint, contract/suppression, all 64 release budgets and strict security pass. Security passes five rule fixtures and scans 1,380 files with zero findings/errors. Formatting, backlog and diff checks are completed before publication. Full web and unchanged dictionary suites are not rerun.

## Publication

The preceding inbox commit `f50b7ea6a608f4086be17b640d62712361b8d134` passes all five gates in [CI run 36897580736](https://github.com/barghsadev/barghsa-core/actions/runs/36897580736).

This batch is published directly to main after validation, with local/remote SHA, clean tree and exact-commit CI registration read back. New CI is pending at publication. Other legacy filters and unfinished domain criteria remain open; global URL serialization stays partial. No PR, supervisor state, handoff, historical completion or scheduler change is included. Existing temporary CI fast mode and its combined-coverage exemption remain; no measured coverage is claimed.
