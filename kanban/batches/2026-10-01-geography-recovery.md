# Province and city catalogue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition for province and city catalogues, including their editors and bulk city import. Existing geography domain requirements are already built and are not counted as newly complete. The all-list parent remains partial for other lists and filter/search/sort work. Legacy geography filter URL serialization remains open.

## Behavior and review

Province and city reads recover independently. Refresh and failed navigation retain accepted rows, their original page range, expanded cities, editor fields and prepared import rows. Retry repeats the requested page and criteria without rereading unrelated resources. Changed criteria hide old rows and discard obsolete private work. Fresh province/city metadata invalidates the affected editor; changing property order does not. Writes pause until their required reads are valid, while drafts and local recovery remain available. Permission denial in either catalogue or a write clears the shared private scope and defeats older responses. Unmounted command completion cannot erase a new draft. Conflicts retain inputs, and command acknowledgements remain validated. Duplicate city/province IDs are rejected before rendering.

Review and browser validation corrected command-button disabled state and successful-save focus restoration: closing a dialog waits for its trigger to become available after the catalogue reload. Existing CRUD, deactivation, bulk-import validation and pagination remain supported. Mobile tables use shared horizontal scrolling. Both dictionaries include localized refresh, local retry and permission-denial text. Existing browser fixtures now use authenticated staff context and persisted locale. No API, database, dependency, scheduler or CI configuration changes are included.

## Validation

Final related web validation passes 423 cases: thirteen new recovery/race cases, ten existing pagination cases, twenty geography API cases and 380 admin-boundary cases. All 53 dictionary cases pass. Final root build/types/lint, all 64 route budgets, contract and suppression checks pass. The final production browser run passes all 40 scenarios, including twenty-four new bilingual light/dark recovery scenarios and sixteen existing CRUD/pagination/dialog scenarios across Chromium/mobile Safari. The earlier run exposed the focus regression and wrapped-text Axe uncertainty; its failed/repeated cases are not added to the total. Axe violations are absent. Reported wrapped description/alert text is verified against its opaque dialog background using measured WCAG contrast and visible text-line hit tests; clipped table text is revealed and rescanned. Keyboard scrolling, focus restoration, mobile overflow and Persian light/dark rendering are verified. No full-web-suite or measured combined-coverage claim is made.

Final formatting and backlog/diff checks pass. The pinned security scan passes all five rule fixtures and scans 1,309 files with zero findings or scanner errors.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/geography-recovery.test.tsx src/pages/geography-pagination.test.tsx src/lib/geography-api.test.ts src/pages/admin-boundaries.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs geography-recovery.spec.ts geography.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Pinned external scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-geography-static-security-final.json` with its environment on PATH
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

The preceding contract-settings batch is published as `3db24c91483475bb12fcedcfafe63896c7436d65`. CI run `36835982680` passes all five jobs under the existing temporary fast mode; combined-coverage success remains an exemption, not measured coverage. The earlier CRM run `36835775110` was cancelled when superseded by the contract-settings main publication, so no success is claimed for that run. Their progress records are updated.

This geography batch is published directly to main after review and final validation. Remote SHA and CI availability are read back after publication; no remote CI success is claimed without a registered, passing run. No PR is created. Historical supervisor state remains unchanged.
