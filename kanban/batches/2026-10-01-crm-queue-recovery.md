# CRM directory and identity correction queue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage composition for the staff CRM directory and identity correction queue. Existing CRM domain requirements are already built and are not counted as newly complete. The broader all-list parent remains partial for other lists and filter/search/sort work. Legacy CRM filter URL serialization remains open.

## Behavior and review

The directory retains accepted rows and expanded profile links while refreshing or retrying an exact cursor. Changed filter/search/sort/timezone criteria hide older results. Malformed reads retain accepted content within its scope, and access denial clears rows, expansion and private search. Account-timezone failure recovers separately; date filters wait for verified settings. The shared horizontal ScrollArea replaces native table-div scrolling for keyboard use across browsers.

The correction queue, selected case detail and profile access recover independently. Queue failure preserves review notes, decisions and case detail; profile failure retains creation fields and the native evidence picker. Local retry reads only its resource. Confirmation pauses until its relevant reads are valid and provides local recovery controls. Fresh case/evidence or authority changes invalidate obsolete decisions; reviewer display names and rotating signed download links preserve valid work. Failed page navigation retries the exact offset, successful navigation preserves off-page review, and a shrinking queue returns to its last valid page.

Queue viewing and profile-based creation remain separate permissions: a queue 403 clears review work while authorized correction-only staff can still create. Authentication denial or denied profile/detail access clears private work and defeats older responses. Changed actors discard private drafts. Cancelled or unmounted uploads and obsolete completion cannot revive confirmation or erase newer work. Review success clears review work without erasing an independent creation draft. Existing fixed-evidence safeguards, separate-reviewer enforcement, CSRF, password step-up and strict command acknowledgements remain supported.

Browser validation found a successful-save focus regression after obsolete work was cleared, premature sorting focus reset, and a missing detail retry when selecting the same failed case again. Sorting now restores focus after the accepted table mounts, and repeated selection rereads its failed case. Completion now restores focus to the enabled identity-field or queue-status control after the dialog has closed. Test review also corrected request-path typing and an unused fixture import. Historical browser fixtures now supply authenticated staff context, persisted locale, valid branding/contact fields and a fixed viewport; clipped content is verified without runtime WebKit resize. The timezone fixture preserves its failure counter. Their failure assertions verify retained accepted rows/forms rather than discarded work.

Legal-profile recovery and actor changes also restore a valid legal identity field instead of an individual-only field; two regression cases cover this reset. Mobile Safari skips the native file input during keyboard Tab navigation, so a localized button opens the same retained native picker and selected file names remain visible. A regression verifies that opening the picker does not submit the form. No API, database, dependency, permission model, scheduler or CI configuration changes are included.

## Validation

Final build/types, root lint with final affected-file lint, all 64 route/interaction budgets, contract/suppression and backlog/diff checks pass. All 403 related web cases pass, including twenty-three new recovery/race/eligibility cases and 380 existing admin-boundary cases. All 53 dictionary cases pass. Final formatting passes. The pinned security scan passes all five fixtures and scans 1,306 files with zero findings or scanner errors. No full-web-suite or measured combined-coverage claim is made.

All 56 distinct production browser scenarios pass across Chromium/mobile Safari. The final full run passes 52 and exposes four native file-input keyboard failures. After the picker correction, fourteen affected creation scenarios pass and two English Safari cases expose a stale Axe assertion assuming only one transparent text node. Final affected verification passes all eight creation/password cases; every reported description/alert node is checked for opaque background, actual contrast and visible-line hit testing. Passing unchanged cases are carried forward, and failed/interrupted or repeated cases are excluded from the distinct total. Persian directory, correction review and final picker/creation rendering is inspected. Accessibility, mobile overflow, keyboard sorting and file selection, exact cursor/date criteria, independent retries and strict acknowledgement checks are included.

Evidence logs: `/tmp/barghsa-crm-recovery-*.log`. The first security run reports zero findings but one scanner error on an unchanged API file; that run is not treated as passing. The final scan passes after concurrent build/browser work has finished.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/crm-recovery.test.tsx src/pages/admin-boundaries.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs crm-recovery.spec.ts crm-list.spec.ts crm-corrections.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Final affected browser cases: same harness with `--grep='correction-only|correction creation'`, followed by `--grep='correction-only staff'` for final dialog text verification
- Pinned external scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-crm-recovery-static-security-final.json` with its environment on PATH
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

The preceding VAT batch is published as `003b51186cec9462fc2c5e5a2a1365bee2621104`. CI run `36832144458` passes all five gates under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This CRM batch is published directly to main as `dea09e44913fb12f8793239a1502fd5a2f6ae936` after review and final validation. Remote SHA and clean worktree are verified. GitHub has not registered a CI run for this SHA at the latest inspection; no CI success is claimed. No PR is created. No historical supervisor state is changed.
