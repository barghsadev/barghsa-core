# Role and upload-policy catalogue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage adoption for staff role definitions and upload-policy categories/history. The parent remains partial: other list pages, legacy filter URL serialization and broader search/sort remain open. These catalogues are small complete API collections, so no artificial pagination or new API is introduced. Existing role and upload-policy domain requirements are already built and are not counted as newly complete.

## Behavior and review

Role list retries preserve accepted definitions, permission grouping and independent staff-user lookup identity/results. Changing the lookup identity clears its previous result. Catalogue or lookup permission denial clears private data, aborts outstanding reads and prevents late results from restoring it. Empty lists show an explicit state without hiding the independent lookup. Predefined roles remain read-only.

Upload access checks recover separately from catalogue reads. Retrying the exact policy/limit collection does not redundantly reread permissions. Accepted rows, expanded history and valid editor inputs remain mounted during recovery; confirmation retains the frozen command body. Refresh/retry controls inside the editor and confirmation allow recovery without closing work. Commands wait for valid access and catalogue data. Cancelling confirmation restores the draft. Changed active policy or deployment ceiling removes obsolete work. Access denial clears private rows/editor/confirmation and invalidates racing reads and late command completion.

Both pages use a shared horizontal viewport with keyboard scrolling, explicit loading/error/empty states and bilingual copy. Upload size/extension ceilings, policy ending, version history, step-up, exact retry body and CSRF remain supported.

Review covered independent resource failures, permission-denial races, changed decision bases, malformed responses, empty lists and completion after cancellation. No API, database, dependency, permission-model, scheduler or CI changes are included. The graph service reported transport closed; bounded source reads supplied the evidence.

## Validation

Evidence logs: `/tmp/barghsa-policy-catalogue-*.log`.

The final related web run covers fifteen new recovery/race/empty-state cases and 380 existing admin-boundary cases (395 total). All 53 dictionary tests pass. Root build/typecheck/lint, contract and suppressed-error checks and all 64 route/interaction budgets pass. Final formatting/backlog/diff checks pass. Unchanged packages and the full web suite are not rerun; this batch uses related unit and browser coverage.

Twelve production browser scenarios pass across Chromium and mobile Safari: eight new bilingual catalogue recovery scenarios and four existing upload save/step-up/exact-retry scenarios. Accessibility, page overflow, horizontal keyboard scrolling, in-dialog recovery and Persian mobile rendering are verified. Older upload browser fixtures now use persisted locale and authenticated staff. Final browser validation runs against the rebuilt production assets after the empty-state correction; earlier passing runs are excluded from final totals.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/policy-catalogue-recovery.test.tsx src/pages/admin-boundaries.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs policy-catalogue-recovery.spec.ts upload-policies.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Targeted ESLint/Prettier checks cover edited source, tests and progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding staff directory batch is verified on main as `0b3529eb51ca826852e72303bdd140564aadf55d`; CI run `36819348656` passes all five gates under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This policy catalogue batch is committed and pushed directly to main after review and related checks. Its remote commit and CI registration are read back after publication. No PR is created. The all-list parent remains partial for the open work above.
