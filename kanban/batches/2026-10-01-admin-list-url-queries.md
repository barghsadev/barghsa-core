# Admin list URL queries, October 1, 2026

## Kanban scope

This batch completes `07-ui-ux-design.md#T-07.18.01.01`, the shared `useListQuery` hook for search, sort, filters, page, page size and cursor pagination. It adopts the hook in geography provinces, nested cities and the CRM directory. `07-ui-ux-design.md#T-07.18.02.04` remains partial because other legacy lists still keep filters locally. Broad ListPage adoption and remaining domain requirements stay open.

## Behavior and review

Geography URLs retain province search, status and page, the expanded province, and independently prefixed city search, status and page. Changing a province criterion clears the expanded city scope in the same navigation. Back restores a valid expansion and its criteria; automatic page correction replaces the current entry.

CRM URLs retain search, profile type, verification, staff-only selection, registration dates, sort direction and the exact opaque cursor. Dates are validated as calendar dates and converted with the existing account timezone logic before API calls. Equal dates remain valid; inverted ranges and invalid values are cleared. A restored cursor does not invent a previous page. Cursor history records only observed navigation and rejects repeated cycles.

The shared hook allowlists fields and sizes, bounds text and page values, omits defaults, preserves unrelated route context and resets pagination when criteria change. Search commits after 300 milliseconds. Selecting another criterion applies pending search in the same navigation, while history navigation cancels obsolete typing. Route adapters integrate with router navigation; the existing view fallbacks keep recovery tests independent of routing.

Accepted rows, failed-refresh warnings, exact retry, abort and permission generations, modal recovery and denial cleanup remain covered. Review corrected calendar validation, array coercion, cursor trimming, the atomic parent/child scope change and an old geography effect that closed restored expansions. Persian mobile views in both themes were inspected. No user-facing strings, database migrations, dependencies or CI configuration are added.

## CI fixture repairs

The preceding staff-access run exposed one wallet test that waited for the lazy dialog container before its confirmation button was ready, and six threshold HTTP fixtures that supplied only password proof after settings began requiring OTP proof. The wallet helper now waits for the actual button. Only those threshold setups receive fresh `otp_step_up_verified_at`, and the OTP-expiry test expires that proof. Existing response, lock, rollback, version and audit assertions remain intact. No production authentication behavior or CI gate is weakened.

## Validation

All 1,779 web cases across 153 files pass in the final full run. The earlier related run passes 471 cases across six files, including the 25 new query-hook cases. Another 52 wallet cases pass across two files; these are included in the full run and are not added to its count. All 104 dual-approval HTTP cases pass against migrated PostgreSQL, including the corrected OTP proof, expiry, concurrent first-write and policy-lock fixtures. Failed and repeated runs are excluded.

All 60 final production browser scenarios pass in Chromium and mobile Safari. Sixteen new URL journeys cover both languages and themes, reload, Back/Forward, independent city scope, exact restored cursors, registration-date conversion, pending-search cancellation and clear. Forty geography CRUD, import and recovery scenarios and four CRM directory recovery scenarios also pass. Scoped Axe, mobile bounds and Persian mobile rendering in both themes are verified.

Root build, types, lint and formatting pass alongside unchanged OpenAPI consistency, suppression checks, all 64 route budgets, backlog validation and diff checks. The pinned strict security scanner passes five rule fixtures and scans 1,354 files with zero findings or scanner errors.

## Publication and CI

The preceding staff-access commit is `3e5d93b58687f9cdc10877ebb6aeff21e2024389`. Its [CI run 36866965461](https://github.com/barghsadev/barghsa-core/actions/runs/36866965461) failed tests and downstream combined coverage. Integrity, security and secret scanning passed, and all 969 database cases passed. The web run had one failing wallet case, and the API log identified the six threshold cases repaired above. The interrupted API job does not establish a full API-suite count. This run is not green.

This batch is committed and pushed directly to main after local validation, with remote SHA, clean worktree and exact-commit CI registration read back. Its remote CI result remains pending at publication. Existing temporary fast mode and the combined-coverage exemption remain unchanged; the exemption supplies no coverage measurement. No PR, supervisor state, handoff or scheduler change is included.

## Commands

- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `pnpm --filter @barghsa/web exec vitest run`, including the related geography/CRM, query-hook and wallet suites
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/admin/dual-approval-http.integration.test.ts`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs admin-list-query.spec.ts geography-recovery.spec.ts geography.spec.ts crm-recovery.spec.ts --grep 'URL restores|province |city |cities |CRM directory' --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
