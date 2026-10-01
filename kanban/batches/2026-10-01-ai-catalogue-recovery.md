# AI model and agent catalogue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage adoption for staff AI model configurations/budgets and agent definitions. The parent remains partial: other list pages, legacy filter URL serialization and broader search/sort remain open. These are complete API collections, so no artificial pagination is added. Existing AI model, budget and agent domain requirements are already built and are not counted as newly complete.

## Behavior and review

Model refresh and retry retain accepted rows, new-model private token input, configuration edits and budget/pricing drafts. Health telemetry and budget usage updates preserve valid work. Changes to the selected model's configuration, budget limits or price basis remove obsolete work. Frozen confirmation waits for valid reads and has its own recovery controls. Unrelated model-test completion keeps a creation draft. Permission denial clears private rows, secret inputs and confirmation; obsolete completion cannot report success or erase newer work. Existing test-before-enable, token keep/replace/clear, deletion conflicts and budget rules remain supported.

Agent list, choices and detail reads recover independently. Opening or cancelling an editor does not reload the directory or options. Ordinary directory retry keeps the prompt, description, selected knowledge/policies/groups and test-chat draft/conversation mounted. Dedicated detail/option retries do not reread unrelated resources. Removed selected choices remain visible and removable; a missing model blocks saving while preserving the prompt. Relevant server configuration changes clear obsolete editing and confirmation. Display-name changes and linked-collection ordering preserve valid selected IDs and prompt work. Permission denial clears retained private work and aborts racing reads.

Agent configuration commands wait for valid relevant reads; deletion can proceed through unrelated option failure and preserves an unrelated new-agent draft. Confirmation has local recovery controls and generation guards. Existing step-up, exact command retry, CSRF, agent test chat/metadata and responsive RTL rendering remain supported.

Review covered read/command races, permission denial, obsolete completion, private-token retention/clearing, model health and budget usage, independently retried agent resources, choice withdrawal and title-sorted collection reordering. The API sorts linked groups by title, so final snapshot comparison uses sorted IDs. No API, database, dependency, permission-model, scheduler or CI changes are included.

## Validation

Evidence logs: `/tmp/barghsa-ai-catalogue-*.log`.

The final related web run covers sixteen new recovery/race cases and 380 existing admin-boundary cases (396 total). All 53 dictionary tests pass. Root build/typecheck/lint, final targeted lint, contract and suppressed-error checks and all 64 route/interaction budgets pass. Final formatting/backlog/diff checks pass. The full web suite and unchanged packages are not rerun; this batch uses related unit and browser coverage.

Thirty-two distinct production browser scenarios pass across Chromium and mobile Safari: twelve new bilingual recovery scenarios and twenty existing model creation/edit/test/deletion/budget and agent configuration/test-chat scenarios. The initial full run passes all 32 without failures. After the final set-comparison correction, the four affected bilingual agent-settings scenarios run again against the rebuilt production assets, now including reordered knowledge selections. Other passing cases are carried forward; repeated cases are not added to distinct totals.

Accessibility, light/dark readability, mobile page overflow, horizontal model-table keyboard scrolling, local confirmation recovery, exact save bodies and step-up behavior are verified. Persian mobile model-budget and agent rendering are inspected. Older authenticated fixtures now supply the staff operating context; the legacy model fixture includes its real nullable budget and circuit fields.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/ai-catalogue-recovery.test.tsx src/pages/admin-boundaries.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs ai-catalogue-recovery.spec.ts ai-models.spec.ts ai-agents.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Final affected browser cases: same harness with `ai-catalogue-recovery.spec.ts --project=chromium --project=mobile-safari --workers=1 --grep='agent settings retry'`
- Targeted ESLint/Prettier checks cover edited source, tests and progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding policy catalogue batch is verified on main as `44b535eefeb8f550622a2d32c9615cfcf5d22b7d`; CI run `36820034160` passes all five gates under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This AI catalogue batch is committed and pushed directly to main after review and related checks. Its remote commit and CI registration are read back after publication. No PR is created. The all-list parent remains partial for the open work above.

Published commit: `7de01e86d651cf9398ba0900dc66cd5ec28b6ade`. CI run `36820922458` subsequently failed: four older `AdminAiModelsPage.test.tsx` cases omitted the real nullable `budget` field, and the security scanner flagged a dummy token literal in the new recovery test. The knowledge/policy recovery batch corrects those fixtures without weakening runtime validation or disabling any checks. The original 396 related tests did not include the older model component test; they are not evidence of a passing full suite. Repair validation and publication are recorded in the next batch report.
