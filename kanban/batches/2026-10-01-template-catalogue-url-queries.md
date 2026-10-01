# Staff template catalogue URL queries, October 1, 2026

## Kanban scope

This batch extends `07-ui-ux-design.md#T-07.18.02.04` to the staff document and notification template catalogues. Document search/category and notification locale/channel/status use the shared query hook and the existing server query contracts. Global URL serialization remains partial. Notification preview selectors, delivery/dead-letter filters, other legacy lists and unfinished domain criteria remain open. This manual batch does not change supervisor assignments or completion history.

## Behavior and review

Document catalogue links retain applied search and category through reload and Back/Forward. Search remains explicit: typing alone does not navigate or fetch, and changing category does not accidentally apply a typed search draft. The independently selected document template and valid metadata, version summary and file drafts survive list filtering and recovery. Private editor content is not serialized. Switching templates clears the preceding template's private drafts, retained file choices, generated links and confirmation; a late mutation receipt cannot apply after its selection generation changes or the page unmounts.

Notification catalogue links retain locale, channel and lifecycle status through reload and Back/Forward. Every applied filter remains independent and reaches the existing server endpoint. Refresh and retry preserve valid message edits; changing catalogue criteria clears obsolete editor, test-send and publishing work, including changes made through browser navigation. Input validation discards unsupported values, arrays, unknown fields and private editor content. Both catalogues retain their existing lazy page loading and standalone page behavior.

Review corrected document selection that previously retained another template's file and version drafts. Browser accessibility checks also found that notification preview sections skipped from level-two to level-four headings. Their headings now follow the existing level-two preview title at level three. Browser locators distinguish catalogue filters from the independent preview and dead-letter controls. API, database, dependencies, CI, scheduler and supervisor are unchanged.

## Validation

All 1,860 web tests across 161 files and 53 dictionary tests pass. Root build, types, lint and formatting pass, including the affected-source lint after the heading repair. OpenAPI consistency, suppression checks, all 64 route and interaction budgets and backlog/diff checks pass. The strict security scan passes five rule fixtures and scans 1,363 files with zero findings or scanner errors.

All 36 distinct production browser scenarios pass in Chromium and mobile Safari on the final build. These include 16 new bilingual light/dark URL scenarios, four document template recovery scenarios, eight notification publishing recovery scenarios, four authoring scenarios and four preview/version scenarios. The new scenarios assert the actual theme, run Axe over the page content and verify mobile viewport bounds. Persian mobile rendering is inspected in both themes. Repeated validation runs do not add to these counts.

## Publication and CI

The preceding contract/document commit is `e2f8a973bad9993f93c2259e4791059ef68a5f9f`; [CI run 36882206166](https://github.com/barghsadev/barghsa-core/actions/runs/36882206166) passes all five gates: tests, integrity, static security, secrets and combined-source coverage. Earlier failed or cancelled runs remain historical failures or cancellations. The combined-coverage success uses the existing exemption and supplies no coverage measurement.

This batch is published directly to main after local validation. Publication verifies the local and remote SHA, clean worktree and exact-commit CI registration; the new CI result is pending at publication. Existing temporary fast mode and the combined-coverage exemption remain unchanged. No PR, handoff, historical loop-state or scheduler change is included.

## Commands

- `pnpm --filter @barghsa/web test`
- `pnpm --filter @barghsa/i18n test`
- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs template-catalogue-query.spec.ts document-list-recovery.spec.ts content-catalogue-recovery.spec.ts notification-template-authoring.spec.ts notification-template-versions.spec.ts --grep 'catalogue URLs|template queue|templates publishing|template authoring|preview selector' --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
