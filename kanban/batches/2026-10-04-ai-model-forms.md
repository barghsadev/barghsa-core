# AI model and budget forms, October 4, 2026

## Kanban scope

This batch advances the shared form parents `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` across model configuration and monthly budgets together. Domain context is `05-notifications-documents-ai.md#T-05.16.03` and `05-notifications-documents-ai.md#T-05.23.02`. Existing model CRUD, connection tests, encryption, circuit state and runtime budget enforcement are not counted as new features. Global form adoption and other AI editors remain partial.

## Behavior and review

Both editors use deferred shared validation, bilingual owned feedback, linked invalid fields and focus after confirmation closes and controls unlock. Incomplete number input stays editable. Synchronous ownership prevents duplicate submissions during validation or confirmation; refresh withdraws pending validation and cannot race a submitted command. Failed reads retain drafts. Changed saved configuration or limits require explicit reset; telemetry and usage changes preserve editing. Unknown or mismatched save receipts freeze writes until an authoritative read after settlement and explicit reset. Current denial clears private work and invalidates late completion.

Response limits are whole numbers from 1 through 4096; temperature is 0 through 2. Budget prices convert decimal USD to exact integer microdollars, rejecting excess precision instead of rounding. A cost limit requires positive input and output prices. Blank limits retain the existing budget-clear semantics. Tokens remain write-only: unchanged edits omit the token, clearing sends an empty string, and replacement requires fresh entry. Changing the destination with a saved token requires explicit replacement or clearing. Accepted receipts must match the captured fields, identity, token choice and success status; malformed numbers, duplicate/empty identities and plaintext token responses are rejected.

API validation returns only owned public field identifiers after permission checks. Existing current-role checks, password step-up, CSRF, audited transactions, test-required enabling and dependency-protected deletion remain enforced. The API has no optimistic model version: refreshed saved bases are compared, but this batch does not add protection against a concurrent change between the last read and a write. No dependency, migration, provider, endpoint path or CI-setting change.

Browser review found duplicate table/page landmarks. The scrolling table now has its own translated accessible name, retaining keyboard scrolling. Persian dark mobile feedback is visually inspected. Security review uses the existing `apiTokenMessage` translation naming convention to distinguish help text from literal credentials, without weakening scanner rules.

## Validation and evidence

All 722 distinct related unit/API/dictionary cases have passing evidence, including 40 new:

- Web: 443 cases across six files; `web-final.log`. The final affected 16/16 form cases also pass after the translation-key correction; `web-copy-final.log`.
- API model controller/service and real HTTP/database: 65/65; `api.log`. Staff permission boundaries: 144/144; `api-boundaries-final.log`.
- Dictionaries: 30/30; `i18n-final.log`.
- Previous CI follow-up: 40/40 audit metadata cases; `ci-fixture.log`. Four create-team fixtures submitted an empty body after required name validation was introduced. They now supply a valid name while retaining authority, socket fallback and untrusted-forwarded-header assertions. Production validation is unchanged.
- All 24 distinct production Chromium/Safari cases have passing evidence, including eight new. The first run passes the 12 existing model/password/budget cases; the affected landmark/recovery run passes 12/12. Earlier failed runs are not counted as whole-run successes. The final eight form scenarios pass again after the translation-key correction; `browser-copy-final.log`. Both languages/themes, RTL, exact writes/receipts, password/CSRF retry, field focus, uncertain recovery, denial, Axe, mobile bounds and keyboard scrolling are covered.
- Root build: seven tasks pass; affected i18n/web builds pass after review corrections. Types: 11 tasks pass. Lint, format, contract and suppression checks pass. All 84 unchanged bundle budgets pass. Final strict security passes five fixtures and scans 1,603 files with zero findings and zero scanner errors; `sast-final.log` and `sast-final.json`. Final publication readback follows the commit.
- Backlog validates 1,355 tasks and 116 traceability entries; final staged diff is checked before publication.

Logs, browser result JSON and Persian dark captures are retained outside the checkout at `/Users/majid/.local/state/barghsa-manual-batches/ai-model-forms/`. Database/browser tests reuse the freshly verified build with `BARGHSA_TEST_PREBUILT=1` to avoid repeated compilation and shared-artifact races. An initial API type error in new assertions and an incorrect permission-test filename were corrected; neither failed invocation is claimed passing.

## Commands and publication

- Web: `pnpm --filter @barghsa/web exec vitest run src/pages/ai-model-forms.test.tsx src/lib/ai-model-form.test.ts src/pages/AdminAiModelsPage.test.tsx src/pages/ai-catalogue-recovery.test.tsx src/pages/admin-boundaries.test.tsx src/components/TeamActionDialog.multipart.test.tsx`.
- API: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/ai-models/ai-models.controller.test.ts src/ai-models/ai-models.service.test.ts src/ai-models/ai-models-http.integration.test.ts`; permission/audit follow-ups use the same build.
- Browsers: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/ai-models.spec.ts e2e/ai-model-forms.spec.ts --project=chromium --project=webkit --workers=2`; affected recovery selection adds `e2e/ai-catalogue-recovery.spec.ts --grep "AI model and budget forms|model drafts, budgets"`.
- Root: `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`.
- Backlog/diff: `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`.

The previous verification [CI run 37182660089](https://github.com/barghsadev/barghsa-core/actions/runs/37182660089) failed four audit fixtures; those fixtures are repaired and locally verified here. Its integrity, security and Git-secret jobs pass. Its dependent coverage job fails with the test job; no unfinished or failed CI result is inferred successful. Publish a conventional commit directly to main, verify local/origin/remote/GitHub SHA agreement and clean checkout, and read back CI registration for that exact commit. No PR is created.

## Remaining work

Model and budget form migration is delivered. Other AI editors, remaining staff forms and global form parents remain open. Generated queue/traceability files, historical supervisor state, external loop state and the scheduler are unchanged. Publication uses the authorized manual direct-main workflow.
