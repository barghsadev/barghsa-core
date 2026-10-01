# Email and SMS provider settings recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition for email and SMS provider catalogues, including retained editor, test and password-confirmation state. Existing email/SMS settings domain tasks (`T-07.30.02.06` and `T-07.30.02.07`) are already built and are not counted as newly complete. The all-list parent remains partial for remaining lists and filter/search/sort work. Broader delivery-history adoption remains open.

## Behavior and review

Provider retries retain accepted rows, email recipients, local credential drafts, SMS mappings and selected test events. Provider catalogue and SMS event-key reads recover independently. A transient read failure pauses dependent commands without clearing local input. Recovery controls remain available inside password confirmation and preserve the pending password. Withdrawn event keys remain visible in existing mappings; saving requires review or removal of those mappings.

Fresh configuration/status/test-eligibility changes invalidate obsolete confirmation. Changed saved draft or clone-source versions retain typed credentials and mappings but block saving until the current version is reopened. Configuration comparison ignores object-key ordering and changing health telemetry. SMS comparison includes the masked credential revision without copying it into editable fields or sending it on update. Permission denial clears private rows, credentials, editor, preview and pending confirmation; older reads and command/password callbacks cannot revive them. Successful confirmation and invalidated review return keyboard focus to provider recovery. Email test outcomes are discarded when their reviewed catalogue changes.

Email lists now reject duplicate IDs. Provider API errors distinguish ordinary permission denial from password step-up and keep server response details private. Existing masking, CSRF, password verification, recovery-channel safeguards, lifecycle acknowledgement checks and provider audit remain supported. Tables use shared horizontal scrolling and logical alignment. Review corrected a duplicate email configuration-error alert and cramped SMS mappings on mobile; the editor now constrains primary fields to the form and keeps mapping controls at usable widths in a keyboard-scrollable table. Browser fixtures use authenticated staff context, persisted locale and fixed mobile viewports.

No backend, database, dependency, scheduler or CI configuration changes are included. Client invalidation reacts to fresh accepted catalogue metadata; it does not introduce a new server-side version-lock protocol.

## Validation

Final related web validation passes 433 cases: twenty-three new recovery/race cases, twenty-nine provider API cases, 380 admin-boundary cases and the existing multipart TeamActionDialog case. All 53 dictionary cases pass. Root build/typecheck/lint, all 64 route budgets, contract and suppression checks pass. All 82 distinct production browser scenarios pass across the first full run and the final 56-scenario affected run; failed and repeated cases are excluded. Sixteen new bilingual light/dark scenarios cover retained drafts, recipients, mappings and password recovery. Existing provider settings, health, lifecycle acknowledgements, secret masking and step-up regressions remain green across Chromium/mobile Safari. Axe reports no violations. Mobile primary-field bounds, usable mapping widths, keyboard horizontal scrolling and Persian light/dark rendering are verified. Formatting and backlog/diff checks pass. The pinned static security scan passes all five rule fixtures and scans 1,313 files with zero findings or scanner errors. No full-web-suite or measured combined-coverage claim is made.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/delivery-provider-recovery.test.tsx src/lib/email-providers-api.test.ts src/pages/admin-boundaries.test.tsx src/components/TeamActionDialog.multipart.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs delivery-provider-recovery.spec.ts email-provider-recovery.spec.ts email-provider-settings.spec.ts sms-provider-settings.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Pinned external scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-provider-static-security-final.json` with its environment on PATH
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

The preceding operational-queue batch is published as `1ee49bea2881aef5d68e8a18b8c267fa6b4003aa`. CI run `36839086915` passes all five jobs under the existing temporary fast mode; combined-coverage success remains an exemption, not measured coverage. Its progress records are updated.

This provider batch is published directly to main after review and final validation. Remote SHA and CI availability are read back after publication; no remote CI success is claimed without a registered, passing run. No PR is created. Historical supervisor state remains unchanged.
