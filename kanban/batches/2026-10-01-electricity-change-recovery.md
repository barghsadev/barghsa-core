# Staff electricity change queue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition for staff electricity quantity-increase requests and contract price adjustments.

Other list adoption, legacy filter URL serialization and broader search/sort remain open, keeping the all-list parent partial. This batch improves the existing quantity/price decision workspaces; it does not mark other electricity UI or domain requirements complete.

## Behavior and review

Increase requests retain the accepted page, rejection reasons and proposed dates during later loading and temporary failures. Local retry requests the exact failed timestamp cursor and pending/expired view. Explicit Refresh returns to the first page. View changes hide rows from the old view, reset drafts and abandon pending decision previews. Fresh data that removes or changes the reviewed request closes its confirmation. Unchanged reads preserve its financial review, password/confirmation state and command key. Invalid queue envelopes become retryable read errors.

Price proposal drafts, financial reviews and command keys survive temporary read failure. Read errors recover independently from failed preview/write messages. Publishing/finalizing/cancelling waits for valid list data and current flags. Changed contract data invalidates previews/confirmations and starts a new proposal key; editable drafts remain. Switching contracts remounts the workspace, clears its old drafts and prevents late previews from reopening old work. Initial failures now have a local retry and explicit Refresh remains available.

Permission denial clears retained data, explanations, dates, confirmations and price proposal drafts. Generation-bound completion callbacks cannot erase new authorized work or reload another view after an old action finishes. The server financial hashes, exact amounts, step-up, idempotent commands and permission enforcement are unchanged. Existing expired finance follow-up and finalized invoice links remain.

Recovery and empty-state labels are bilingual. Contract, order and invoice identifiers use left-to-right isolation within Persian content. Named regions, accessibility and mobile overflow assertions pass; Persian mobile Safari increase and price forms are visually inspected.

No API, database, permission-model, dependency, scheduler or CI changes are included.

## Validation

Evidence logs: `/tmp/barghsa-electricity-change-*.log`.

The full web regression passes 1,260 tests in 125 files before the final publish-key, completion-callback and identifier-isolation fixes. After those fixes, all twenty related tests pass: twelve new recovery cases and eight existing increase/price regressions. These cover exact cursor retry, retained inputs/dialogs, malformed envelopes, independent errors, fresh eligibility/version changes, scope/denial races and obsolete completion callbacks. All 53 dictionary tests pass.

Final root build/typecheck, targeted lint and all 64 route budgets pass. Root lint, contract and suppressed-error checks also pass. Final formatting, canonical backlog and diff validation pass.

All eighteen browser cases pass in the final run without failures or retries: twelve new bilingual recovery/financial-command cases and six related electricity journeys across Chromium and mobile Safari. Failed writes reuse the exact reviewed hash and idempotency key. The journey fixture now initializes persisted locale instead of clicking a language control hidden on mobile, and fixes Date while leaving UI timers running. The initial run passed thirteen cases and failed five, including two initial navigation timeouts and older journey fixture failures; failed and repeated cases are excluded from passing totals.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/pages/electricity-change-recovery.test.tsx src/pages/admin-electricity-increases.test.tsx src/pages/electricity-price-adjustments.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test electricity-change-recovery.spec.ts electricity-journey.spec.ts --project=chromium --project=mobile-safari --workers=2`
- Targeted `pnpm exec eslint` and `pnpm exec prettier --check` cover the final edited source, tests and progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding document batch is published as `2934bcadfc23ab1837dc92456a4b87e6fc1b0a2b`; CI run `36790376542` passes all five gates under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This electricity change batch is committed and pushed directly to main after review and related checks. Its remote commit and CI are verified after publication.
