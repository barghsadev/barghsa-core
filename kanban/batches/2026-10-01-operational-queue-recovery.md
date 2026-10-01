# Failed-job and notification queue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition for the failed-background-job and failed-notification queues, including the dead-letter panel embedded in notification administration. Existing job and notification domain requirements are already built and are not counted as newly complete. The all-list parent remains partial for other lists and filter/search/sort work. Legacy operational filter URL serialization and broader delivery-history list adoption remain open.

## Behavior and review

Queue and authority reads recover independently. Refresh and failed navigation retain accepted rows, their accepted page number, expanded masked details, job selections, delivery history and pending confirmation/password fields. Exact-page retry uses the same criteria and offset. Commands pause until their required reads are valid; local access/queue recovery controls remain available inside confirmation. Changed criteria hide old rows and discard obsolete confirmation. Fresh job/delivery metadata and withdrawn retry permission remove stale command review. Parent view denial clears cached rows, selections, confirmations and open delivery history, and invalidates older responses. Obsolete command completion cannot publish a success notice. Delayed password verification cannot submit after a required read becomes unavailable.

Job authority and rows are validated before rendering. Both queues reject duplicate IDs and malformed data. Background-job acknowledgements must contain the chosen IDs/types and expected resulting status; bulk acknowledgements accept a unique subset and report the skipped count. Existing exact notification acknowledgement checks remain. An optional denial callback on TeamActionDialog clears these queues after a command returns authentication/authorization denial; step-up-required responses retain their existing password workflow, and other callers retain existing behavior.

Review corrected successful-save focus when a command removes its trigger or leaves the bulk button disabled: focus returns to the available trigger or Refresh after reload. Dead-letter commands use shared accessible buttons. Tables use shared horizontal scrolling. Existing API permissions, CSRF, password step-up, audit and server-side retry/resolve/dismiss transitions remain supported. Browser fixtures now use authenticated staff context, persisted locale, fixed mobile viewport and valid job metadata. No API, database, dependency, scheduler or CI configuration changes are included.

## Validation

Final related web validation passes 404 cases: twenty-three new recovery/race/acknowledgement cases, 380 admin-boundary cases and the existing multipart TeamActionDialog case. All 53 dictionary cases pass. Final root build/types/lint, all 64 route budgets, contract and suppression checks pass. The first production browser run passes all 68 scenarios across Chromium/mobile Safari: forty new bilingual light/dark recovery/history scenarios and twenty-eight existing triage, pagination, permission, history, acknowledgement and step-up regressions. Counts exclude repeated unit verification. Axe violations are absent; wrapped dialog text uses measured WCAG contrast and visible text-line hit tests, and clipped table text is revealed and rescanned. Keyboard scrolling, selection retention, focus restoration, mobile overflow and Persian light/dark rendering are verified. Final formatting and backlog/diff checks pass. No full-web-suite or measured combined-coverage claim is made.

The pinned static security scan passes all five rule fixtures and scans 1,311 files with zero findings or scanner errors.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/operational-queue-recovery.test.tsx src/pages/admin-boundaries.test.tsx src/components/TeamActionDialog.multipart.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs operational-queue-recovery.spec.ts failed-jobs.spec.ts failed-notifications.spec.ts failed-notifications-recovery.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Pinned external scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-operational-static-security-final.json` with its environment on PATH
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

The preceding geography batch is published as `e6cab8a025f04338f0b1d1c5d0b9a84f18c841c9`. CI run `36837452104` passes all five jobs under the existing temporary fast mode; combined-coverage success remains an exemption, not measured coverage. Its progress records are updated.

This operational batch is published directly to main after review and final validation. Remote SHA and CI availability are read back after publication; no remote CI success is claimed without a registered, passing run. No PR is created. Historical supervisor state remains unchanged.
