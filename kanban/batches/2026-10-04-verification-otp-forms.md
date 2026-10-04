# Verification and OTP settings forms, October 4, 2026

## Kanban scope

This batch advances the shared form parents `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` across verification mode and OTP lifetime together. Domain context is `02-auth-users-admin.md#T-07.01.01`, `02-auth-users-admin.md#T-01.02.01` and `07-ui-ux-design.md#T-07.30.02.14`. Existing versioned APIs and OTP issuance are not counted as new features. Global form adoption and the wider verification settings task remain partial; an automatic identity provider is still unavailable.

## Behavior and review

Both forms use deferred shared validation, bilingual owned feedback, linked invalid fields, stable feedback space and focus after controls unlock. OTP lifetime must be a whole number from 60 through 900 seconds. Verification retains its separate draft-save and password-protected activation operations. OTP changes require password confirmation. Saving either configuration preserves unsaved values in the other form.

A small shared snapshot hook retains drafts across failed reads. Changed saved revisions withdraw captured commands and require explicit reset. Unknown or mismatched receipts freeze further writes until a successful authoritative read and explicit reset. Refresh cancels pending validation, but cannot race a submitted command. Receipts must match the captured values, expected version plus one and success status. Current denial clears the affected private state and invalidates late callbacks.

Review repaired two focus/hydration defects: form reset cleared the composite radio focus target, and the default manual choice briefly appeared before the saved disabled setting hydrated. A Profiler regression fails on the old hydration behavior and passes with the fix. API errors publish only owned field identifiers after authority checks. Permission, CSRF, password step-up, optimistic versions, transactional audit, issuance and existing OTP deadlines remain enforced. Deploy additive field errors with or before the frontend. No dependency, migration, endpoint path or CI settings change.

## Validation and evidence

All 667 distinct related unit/API/dictionary cases have passing evidence, including 25 new cases:

- Web: 417/417 across five files; `web-final.log`.
- Real HTTP/database: 29/29; `api.log`. Permission boundaries: 144/144; `api-boundaries.log`. The two edited field-error assertions also pass in `api-fields-final.log`; its other 27 cases are deliberately unselected, not claimed rerun.
- Dictionaries: 77/77; `i18n.log`.
- Root build: seven tasks pass; the final affected web rebuild passes after the hydration correction. Types: 11 tasks pass. Lint, contract and suppression checks pass. All 84 unchanged bundle budgets pass; verification is 381.43 KB/500 KB.
- All 28 distinct production browser cases have passing evidence. The final affected mode/form run passes 12/12 after the hydration fix; 16 unchanged OTP cases have passing evidence from `browser.log` and `browser-recovery.log`. Both languages/themes, RTL, focus, retained companion drafts, password/CSRF, exact receipts, changed revisions, recovery, Axe and mobile bounds are covered. Persian dark mode/OTP feedback is visually inspected.
- Final strict security passes five fixtures and scans 1,600 files with zero findings and zero scanner errors; `sast.log` and `sast.json`.
- Backlog validates 1,355 tasks and 116 traceability entries. Final formatting and staged diff checks precede publication.

Initial failed runs are not counted as whole-run successes. The browser fixtures now use the authenticated staff shell and actual persisted locale, identify the saved status separately from readback loading, and require explicit recovery after unknown receipts. Docker was restarted for database validation. An initial standalone browser setup rebuilt shared artifacts during a concurrent unit run; that import race is not accepted as passing. Later checks reuse the freshly verified build with `BARGHSA_TEST_PREBUILT=1`, avoiding rebuild races and redundant compilation. Production guards, scanner settings and CI checks are unchanged.

Logs and Persian dark captures are retained outside the checkout in `/Users/majid/.local/state/barghsa-manual-batches/verification-otp-forms/`.

## Commands and publication

- Web: `pnpm --filter @barghsa/web exec vitest run src/pages/verification-settings-forms.test.tsx src/components/otp-audit-boundary.test.tsx src/pages/admin-boundaries.test.tsx src/hooks/useCatalogueResource.test.tsx src/components/TeamActionDialog.multipart.test.tsx`.
- API: `pnpm --filter @barghsa/api exec vitest run src/admin/verification-mode-http.integration.test.ts src/auth/otp-config-http.integration.test.ts`; prebuilt permission and affected field runs use the same current API build.
- Browsers: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/verification-mode.spec.ts e2e/verification-settings-forms.spec.ts --project=chromium --project=webkit --workers=2`; OTP evidence uses `e2e/otp-config.spec.ts`.
- Root: `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`.
- Backlog/diff: `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`.

Publish a conventional commit directly to main after checks, then verify local/origin/remote/GitHub SHA agreement, clean checkout and exact-commit CI registration. No PR is created. At the latest read, the previous storage [CI run 37181598679](https://github.com/barghsadev/barghsa-core/actions/runs/37181598679) passes security, integrity and Git-secret jobs; its test job remains running. No unfinished CI result is inferred.

## Remaining work

The two settings forms are migrated. Global form adoption, other staff configuration/AI editors and the wider verification provider workflow remain open. Generated queue/traceability files, historical supervisor state, external state and the scheduler are unchanged. Publication uses the authorized manual direct-main workflow, with no PR.
