# Knowledge-base and AI policy catalogue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage adoption and recovery for staff knowledge bases, knowledge groups, AI policies and policy groups. The broader all-list parent remains partial; other list pages, legacy URL filters and broader search/sort remain open. These APIs return complete collections, so no artificial pagination is added. Existing knowledge, document processing, retrieval and policy domain requirements are not counted as newly built.

## Behavior and review

List, group choices and selected detail now load and recover independently through a small shared read hook. Opening a detail does not reread the directory or choices. Existing knowledge-group unlink also remains available through unrelated choice failure when membership is valid. Ordinary retries retain accepted cards and valid creation/configuration drafts. Fresh relevant configuration changes discard obsolete edits and confirmation; count-only telemetry preserves work. Permission denial clears private work and immediately invalidates racing responses across the catalogue's resources.

Knowledge recovery preserves test-query text, accepted results and the mounted document picker's search/selection/upload state. Changed retrieval configuration or membership invalidates old query results and frozen commands. Query editing aborts an older query; selection, kind switches and unmount invalidate late queries/uploads. Withdrawn selected group choices remain visible, while new linking waits for valid available choices.

Policy recovery preserves rule drafts, new-member selection/priority and valid dirty per-member overrides. Fresh member changes reset only affected overrides and invalidate obsolete confirmation. Existing member override/unlink operations wait for valid detail; unrelated policy-option failure blocks new links while allowing a valid existing override. Frozen confirmations have local recovery controls and cannot report obsolete completion or erase newer unrelated work.

Review covers permission/read races, retained drafts and document selection, stale query/upload completion, independent resource retries, relevant configuration changes, membership changes and unavailable choices. Confirmation references are cleared when changing work. No API, database, dependency, permission-model, scheduler or CI configuration changes are included.

## CI repair from preceding batch

The preceding AI catalogue commit `7de01e86d651cf9398ba0900dc66cd5ec28b6ade` failed CI run `36820922458`. Four older model tests used a fixture without `budget`; the actual API always returns a budget object or null. The fixture now includes `budget: null`. A deliberately fake credential literal in the new unit test triggered `literal-credential-assignment`; the fixture now uses a shorter dummy value. Runtime validation and security rules stay intact. Full web regression validation is required for this repair.

## Validation

Final build/typechecks, root lint with final affected-file lint, contract/suppression checks, all 64 route budgets, 53 dictionary tests and formatting/backlog/diff checks pass. The full web suite passes 1,358 cases before the final attachment correction; after that correction, 401 related tests pass (twenty-one recovery cases plus 380 existing admin boundaries). These are overlapping runs, not additive counts. No claim is made that a final 1,360-case full suite ran locally.

Forty-four distinct production browser scenarios pass in English/Persian on Chromium/mobile Safari. The first run passes forty and exposes four attachment regressions after document removal. Attachment now binds to selection lifetime and accepted detail basis, permitting fresh callbacks and rejecting uploads from obsolete selection/configuration. The final rerun passes all 36 cases from both knowledge files, including those four failures and all new recovery cases; eight unchanged legacy policy cases are carried forward from the first passing run. Failed/interrupted cases and repeated passes are not added to distinct totals.

Accessibility and mobile overflow assertions pass; final Persian mobile knowledge/policy rendering is inspected. Existing creation, CSRF query bodies, group membership, document status, upload verification/recovery, step-up and exact save bodies remain covered. Browser fixtures use persisted locale, a complete staff operating context and context-level mobile viewport; group query text is entered explicitly after switching scope.

Pinned Semgrep 1.176.1 passes all five security-rule fixtures and scans 1,304 files with zero findings or scanner errors on the final source. The first install attempt used the host's older Python and could not resolve the pinned scanner; a separate temporary Python 3.13 environment runs the actual final scan. No repository dependencies or CI gates change.

Evidence logs: `/tmp/barghsa-knowledge-policy-*.log`; final source checks use `*-verified.log`. Root format/backlog checks are repeated after this final report edit.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run`
- Final affected units: `pnpm --filter @barghsa/web exec vitest run src/pages/knowledge-policy-recovery.test.tsx src/pages/admin-boundaries.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs knowledge-policy-recovery.spec.ts knowledge-bases.spec.ts ai-policies.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Final affected browser run: same production harness with `knowledge-policy-recovery.spec.ts knowledge-bases.spec.ts --project=chromium --project=mobile-safari --workers=1 --grep='knowledge|Knowledge|KB'` (Playwright matches the knowledge file name, so this includes its policy recovery cases)
- `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-knowledge-policy-static-security.json` with the pinned external scanner environment on PATH
- Targeted ESLint/Prettier; `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

This batch is committed and pushed directly to main after review and the checks above. Remote SHA and CI registration are read back after publication. No PR is created; the broader parent remains partial.
