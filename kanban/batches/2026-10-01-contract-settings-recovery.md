# Contract template and electricity-limit settings recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt the shared ListPage for the contract template catalogue. Contract electricity-limit settings participate in the same recovery batch. Existing template and electricity-limit domain requirements are already built and are not counted as newly complete. The all-list parent remains partial for other lists and filter/search/sort work. Broader electricity settings remain partial.

## Behavior and review

Template catalogue and selected history recover independently. Refresh and retry preserve metadata edits and prepared UTF-8 file content. Opening or reselecting a template does not reread the catalogue. An empty catalogue supports a new template draft. Local recovery pauses commands until their required reads are valid; frozen confirmations expose refresh and local retry controls. Changed template metadata, versions or deletion eligibility invalidate obsolete confirmation. Upload success and deletion of another template preserve independent metadata edits. Permission denial clears private work and defeats older responses. Cancellation, selection changes and unmount invalidate late file reads and command completion.

Electricity limits retain valid proposals through refresh and malformed/unavailable reads. Fresh limits reset obsolete edits and invalidate old confirmation; unchanged values preserve the draft. Explicit recovery from authentication or authorization denial starts without the old private draft. Range validation prevents invalid proposals. Both pages verify command acknowledgements before reporting success. Existing API permissions, CSRF, password step-up, append-only version storage and server-side validation remain supported.

Review corrected active-template reselection and independent draft preservation after upload or unrelated deletion. The historical unit template fixture now supplies a UUID and latest-version metadata. Existing browser fixtures use authenticated staff context, persisted locale and actual command acknowledgement shapes. No API, database, dependency, scheduler or CI configuration changes are included.

## Validation

Local validation passes 401 related web cases, including twenty-one new recovery/race/eligibility cases and 380 existing admin-boundary cases. All 53 dictionary cases pass. Root build/types/lint, all 64 route budgets, contract and suppression checks pass. All 32 distinct production browser scenarios pass across Chromium/mobile Safari. The full run passes 28 and exposes four stale assertions attempting to click a correctly disabled Save button after entering invalid limits. Final affected verification passes all four limit/password cases after asserting the disabled state instead. Passing unchanged scenarios are carried forward; failed and repeated cases are excluded from the distinct total. Both languages and both themes, independent retries, frozen confirmations, UTF-8 picker keyboard use, access denial, accessibility and mobile overflow are verified. Persian mobile light/dark rendering is inspected. Final formatting and backlog/diff checks pass. The first security scan has zero findings but one scanner error on unchanged `apps/api/src/admin/admin.controller.ts`; it is not treated as passing. The final scan after other checks finish passes all five fixtures, with 1,307 files scanned, zero findings and zero scanner errors. No full-web-suite or measured combined-coverage claim is made.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/contract-settings-recovery.test.tsx src/pages/admin-boundaries.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs contract-settings-recovery.spec.ts contract-templates.spec.ts contract-limits.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Final affected browser cases: same harness with `contract-limits.spec.ts` only
- Pinned external scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-contract-settings-static-security-verified.json` with its environment on PATH
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

The preceding CRM batch is published directly to main as `dea09e44913fb12f8793239a1502fd5a2f6ae936`. Remote SHA and clean worktree were verified. Its CI run `36835775110` was cancelled when the following main publication superseded it; no CI success is claimed for that cancelled run.

This contract settings batch is published directly to main as `3db24c91483475bb12fcedcfafe63896c7436d65` after review and final validation. Remote SHA and clean worktree were verified. CI run `36835982680` passes all five jobs under the existing temporary fast mode. Combined-coverage success is an exemption, not measured coverage. No PR is created. Historical supervisor state remains unchanged.
