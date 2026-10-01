# Notification panel URL queries, October 1, 2026

## Kanban scope

This batch extends `07-ui-ux-design.md#T-07.18.02.04` to notification preview selectors and failed-message filters and pagination. It covers both the queue embedded in `/admin/notifications` and the dedicated `/admin/failed-notifications` page. Delivery-history filters, other legacy lists and unfinished domain criteria remain open; global URL serialization remains partial. Delivery-window fields are persisted configuration, not filters. No supervisor assignment or completion history changes.

## Behavior and review

Notification preview event, channel, language and selected version identifier use the shared URL query hook. Applied selection survives reload and Back/Forward. Parent selector changes clear dependent selectors together; resetting preview keeps catalogue and queue criteria intact. Restored selection remains intact during pending and failed catalogue reads. Only an accepted response for the current catalogue criteria can discard unavailable selectors or versions. The reset button also appears for language, channel or version alone.

Failed-message status, channel, severity and page use independent `failed_` parameters in both queue views. Open messages remain the default; the explicit `all` value restores the all-status choice. Criteria changes reset the queue to its first page without changing preview or catalogue filters. The existing API receives the same filter names, page size and offset as before. Page validation and navigation respect its maximum offset of 1,000,000. Retry preserves the accepted page and repeats the exact failed query; permission denial clears private work. Criteria or page navigation closes obsolete confirmations and rejects late receipts, as do denial and unmounting.

Review preserves lazy route loading, standalone component behavior, existing authoring/recovery flows and independent delivery history. URL validation excludes unknown fields, private editor content, message destinations and credentials; it rejects unsupported enum values, arrays, oversized identifiers and invalid pages. No API, database, dependency, CI, scheduler or supervisor changes.

## Validation

All 1,873 web tests across 163 files and 53 dictionary tests pass. The new query tests cover scope isolation, explicit all-status restoration, invalid inputs and server pagination bounds. A component regression verifies that pending and failed catalogue reads preserve a restored preview until accepted data can validate it. Root build, types, lint and formatting pass, with affected-source lint after the final guard and test changes. OpenAPI consistency, suppression checks, all 64 route and interaction budgets and backlog/diff checks pass. Strict security passes five rule fixtures and scans 1,365 files with zero findings or scanner errors.

All 52 distinct production browser scenarios pass in Chromium and mobile Safari on the final build. These include 16 new bilingual light/dark URL scenarios, four existing preview/version scenarios, eight confirmation recovery scenarios, eight failed-page recovery scenarios, eight independent delivery-history scenarios and eight catalogue/edit recovery scenarios. Reload and Back/Forward preserve each scope; page navigation closes stale confirmation, failed pages retain accepted rows, exact retry and permission denial are verified. The new scenarios assert the actual theme, run Axe over page content and verify mobile viewport bounds. Persian mobile preview and queue rendering is inspected in both themes. Repeated validation runs do not add to these counts.

## Publication and CI

The preceding template catalogue commit is `40172ae736abf3b84e8b47d404a39a03c6249cfa`. [CI run 36884131168](https://github.com/barghsadev/barghsa-core/actions/runs/36884131168) passes all five gates: tests, integrity, static security, secrets and combined-source coverage. The existing combined-coverage exemption supplies no coverage measurement.

This batch is published directly to main after local validation. Publication verifies local and remote SHAs, a clean worktree and exact-commit CI registration; the new CI result is pending at publication. Existing temporary fast mode and the combined-coverage exemption remain unchanged. No PR, handoff, historical loop-state or scheduler change is included.

## Commands

- `pnpm --filter @barghsa/web test`
- `pnpm --filter @barghsa/i18n test`
- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs notification-panel-query.spec.ts notification-template-versions.spec.ts operational-queue-recovery.spec.ts template-catalogue-query.spec.ts --grep 'notification preview and queue URLs|failed notification URLs|preview selector|notifications confirmation|notifications failed page|delivery history remains|notification catalogue URLs' --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
