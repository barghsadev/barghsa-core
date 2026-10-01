# Contract and document URL queries, October 1, 2026

## Kanban scope

This batch extends `07-ui-ux-design.md#T-07.18.02.04` to the staff contract queue and customer/staff document queues using the shared query hook. Global URL serialization remains partial; other legacy lists and unfinished domain criteria remain open. This manual batch does not change supervisor assignments or completion history.

## Behavior and review

Staff contract links retain the applied contract number, profile, state, service, cursor and selected contract. Positive signed 64-bit contract numbers stay exact strings, including the maximum value; unsafe number inputs and overflow are rejected. Existing contract details outside the displayed page remain reachable. Document links retain applied file search, relation, state, category, business-record scope, cursor and selected document. Staff links also retain the profile criterion. An explicit staff All statuses choice remains distinct from the default review queue after reload. Customer profile authority comes from the active server context; a profile ID supplied in the URL does not change access scope.

Reload and Back/Forward restore applied criteria independently of selection. Unapplied filter drafts remain local and survive pagination. Applying changed criteria clears cursor and selection together. Real next pages accumulate without duplicate rows; restored or refreshed pages replace unrelated accumulation. Previous navigation uses only observed history, and repeated server cursors cannot cycle. Selection changes do not unnecessarily reload the list, clear obsolete private work and reject late upload receipts. Retry preserves accepted rows, selected review and upload work. Both 401 and 403 discard private queue work and URL selection.

Review found that a page-local effect could not reset customer document scope after the root's profile remount. A profile-context reset subscription now clears cursor and selection before that remount, including cross-tab changes, while preserving applied filters. The regression verifies two consecutive local changes and subscription cleanup; browser scenarios verify cross-tab changes with a populated cursor, an unsaved upload and a selected document. Selection, creation and embedded business-document workflows retain their existing contracts.

The route wiring tests now render their adapted pages and verify restored criteria, replacing obsolete component-identity assertions. An existing recovery fixture waits for its applied-filter request to settle before changing its mocked response, avoiding a race with an older error view. Visual review also corrected an incomplete branding fixture and added an explicit theme assertion, so dark cases cannot silently test light mode. No assertion is removed. API, database, dependencies, CI, scheduler and supervisor are unchanged.

## Validation

The final full web suite passes all 1,853 cases across 160 files. All 53 dictionary cases pass. Root build, types, lint and formatting pass; final affected-file lint also passes after the browser fixture corrections. OpenAPI consistency, suppression checks, all 64 route budgets and backlog/diff checks pass. The pinned strict scanner passes five fixtures and scans 1,362 files with zero findings or scanner errors.

All 60 distinct production browser scenarios pass in Chromium and mobile Safari. Twenty-four bilingual/themed URL journeys cover all three routes, applied API criteria, exact 64-bit numbers, cursor pagination, reload, Back/Forward, independent selection and private-draft reset. The final affected 24 cases pass again with explicit theme assertions after the branding fixture correction. Sixteen existing document/template/destruction recovery scenarios retain review, metadata, version, upload and approval work, retry failed pages and discard obsolete work. Twelve contract-finance recovery cases preserve explanation, bank and rejection drafts; eight contract workflows cover staff publication and customer acceptance/signed uploads. Scoped Axe and mobile bounds pass; Persian mobile rendering is inspected in both themes. Failed and repeated runs are excluded from the distinct passing total.

## Publication and CI

The preceding support/consultation commit is `cb65fbbb25d6d34c231751a3880c202efde7f63a`; [CI run 36878486025](https://github.com/barghsadev/barghsa-core/actions/runs/36878486025) passes all five gates: tests, integrity, static security, secrets and combined-source coverage. Earlier failed or cancelled runs remain historical failures or cancellations. The combined-coverage success uses the existing exemption and supplies no coverage measurement.

This batch is committed and pushed directly to main after local validation. Remote SHA, clean worktree and exact-commit CI registration are read back. Remote CI for this new batch remains pending at publication. Existing temporary fast mode and the combined-coverage exemption remain unchanged. No PR, handoff, historical loop-state or scheduler change is included.

## Commands

- `pnpm --filter @barghsa/web test`
- `pnpm --filter @barghsa/i18n test`
- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs record-list-query.spec.ts document-list-recovery.spec.ts contract-finance-list-recovery.spec.ts contracts.spec.ts --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- Final affected rerun: `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs record-list-query.spec.ts --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
