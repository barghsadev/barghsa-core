# Staff directory and team assignment recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage adoption for the staff directory and team directory, with independent recovery for their editors and assignment resources. The parent remains partial: other lists, legacy filter URL serialization and broader search/sort remain open. Existing staff domain requirements are already built and are not counted as newly complete.

## Behavior and review

Staff list retries preserve accepted rows, exact offset, creation inputs and valid role explanations without rereading access or role options. Access and role choices recover independently. Explicit refresh and successful mutations refresh access. Revoked permissions or a changed actor clear private work and one-time passwords; generation guards prevent obsolete reads or command completion from reviving it. Fresh role/status changes invalidate obsolete editing, while routine login telemetry preserves the explanation. Withdrawn selected roles remain removable. Malformed creation confirmation reports failure and retains inputs.

Team list, routing rules and member search recover independently. Retrying members retains selected members, leader and exact search/team scope. Team updates preserve unrelated dirty routing rules; deleting another team preserves a new-team draft. Fresh membership eligibility or team changes invalidate stale confirmation. Permission denial clears private data and invalidates racing responses. Inputs remain usable during recovery; commands wait for valid decision resources.

Both tables use shared pagination and keyboard-accessible horizontal viewports. Existing role/session invalidation, self-disable protection, activation resend, temporary passwords, team leaders, fallback ordering, CSRF and step-up behavior remain supported. New recovery strings are available in English and Persian.

Review covered stale-response races, permission/actor changes, draft preservation, selected-role withdrawal, member eligibility, malformed responses and command completion after unmount. No API, database, dependency, permission-model, scheduler or CI configuration changes are included.

## Validation

Evidence logs: `/tmp/barghsa-staff-directory-*.log`.

The final web regression passes all 1,308 tests in 128 files. The related run passes 398 cases in two files, including eighteen new recovery/race cases. All 53 dictionary tests pass. Root build (seven tasks), typecheck (eleven tasks), lint, contract and suppressed-error checks and all 64 route/interaction budgets pass. Final targeted lint/typecheck, root formatting and backlog/diff checks pass.

All 42 distinct production browser scenarios have passing evidence across Chromium and mobile Safari: sixteen new bilingual recovery scenarios and 26 existing staff directory, creation and team scenarios. The initial run supplied 22 passing scenarios before interruption; two corrected Chromium role-recovery scenarios, sixteen remaining mobile scenarios and two corrected mobile fallback scenarios supply the remaining twenty. The first failures were assertions waiting for a checkbox removed by its own click and a legacy accessibility assertion including a hidden global theme selector. Corrections assert removal and scope relevant controls to the staff content. Failed, interrupted and repeated cases are excluded from passing totals. Product code was unchanged during assertion repairs.

Accessibility, mobile overflow, horizontal keyboard scrolling and existing light/dark role, step-up, permission-history, resend and fallback flows pass. Persian mobile staff/team screenshots were inspected. Older browser fixtures now initialize authenticated staff and persisted locale; denied-team coverage reaches the actual team page.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/pages/staff-directory-recovery.test.tsx src/pages/admin-boundaries.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs staff-directory-recovery.spec.ts staff-users.spec.ts staff-teams.spec.ts staff-creation.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Corrected Chromium: same harness with `staff-directory-recovery.spec.ts --project=chromium --workers=1 --grep='staff access and role choices'`
- Remaining mobile: same four files with `--project=mobile-safari --workers=1 --grep-invert='staff creation retains|staff list retries.*\(en\)'`
- Corrected mobile: same harness with `staff-teams.spec.ts --project=mobile-safari --workers=1 --grep='fallback priorities'`
- Targeted ESLint/Prettier checks cover edited source, tests and progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding payment review batch is verified on main as `46898927197c2b5337732f6f8b8b5998c14d4153`; CI run `36817128210` passes all five gates under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This staff directory batch is committed and pushed directly to main after review and related checks. Its remote commit and CI registration are read back after publication. No PR is created. The all-list parent remains partial for the open work above.
