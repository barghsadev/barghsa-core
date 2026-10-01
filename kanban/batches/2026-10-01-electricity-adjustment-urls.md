# Electricity adjustment URLs, October 1, 2026

## Scope and behavior

This related batch extends `07-ui-ux-design.md#T-07.18.02.04` across the staff electricity increase queue and price-adjustment contract workspace. Increase status and UUID cursor, and the selected price contract, survive reload and Back/Forward. Status changes reset the cursor. Only applied public selections enter URLs. Reasons, effective-date drafts, percentages, contractual basis, review data and credentials remain local. Other legacy filters and unfinished domain criteria remain open; global URL serialization stays partial.

A failed next-page read retains accepted increase rows and valid reasons/dates, with exact-query retry. History changes clear obsolete private work and confirmation; late reviews and callbacks cannot dismiss newer work or reload another scope. Pending More stays visible and disabled; repeated cursors cannot advance. Price input edits do not fetch or navigate until Open. Applied contract changes remount the existing workspace and dispose of the old contract's drafts and financial confirmation. Invalid contract identifiers cannot open a workspace. Existing permission denial and financial hash/idempotency handling remain.

## Review

Both route adapters, scope-change cleanup, cursor navigation and financial callbacks were reviewed against the API. The increase controller accepts a UUID `before`; its service returns at most 50 rows and uses the last request UUID as the next cursor. The old recovery fixture incorrectly used a timestamp. Initial tests caught this discrepancy, and the shared fixture now matches the actual API. Existing price tests also use valid UUID selections. Strict public parsing rejects surrounding whitespace without changing the shared identifier helper or API. Standalone consumers retain their local controls.

## Validation

- `pnpm --filter @barghsa/web exec vitest run src/lib/electricity-change-query.test.ts src/pages/electricity-change-navigation.test.tsx src/pages/admin-electricity-increases.test.tsx src/pages/electricity-price-adjustments.test.tsx src/pages/electricity-change-recovery.test.tsx` passes 37 cases across five files. This includes 13 parsing cases, four navigation regressions and existing financial/recovery cases. The full web and unchanged dictionary suites are not rerun.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/electricity-change-query.spec.ts e2e/electricity-change-recovery.spec.ts --project=chromium --project=mobile-safari --workers=2` passes all 20 production browser scenarios without retries. Eight new URL flows and 12 existing financial/recovery flows cover both languages and browsers, actual light/dark themes, reload/history, exact retry, draft retention/disposal, stale confirmation, invalid selection, permission denial and exact financial hash/idempotency. Scoped Axe and mobile bounds pass. Both Persian dark mobile screens are visually inspected.
- Root build passes seven tasks; root types pass 11. Root lint, formatting, contract/suppression checks and all 64 release budgets pass. Strict security passes five fixtures and scans 1,377 files with zero findings/errors. Backlog and diff checks pass before publication.

## Publication

The preceding solar queue commit `8c30267965ceb365c25161175a888c163bd4690a` passes all five CI gates in [run 36895403901](https://github.com/barghsadev/barghsa-core/actions/runs/36895403901).

This batch is published directly to main after local validation, with local/remote SHA, clean tree and exact-commit CI registration read back. New CI remains pending at publication. No PR, API/database/dependency/CI, supervisor assignment, handoff, historical completion or scheduler change is included. Existing temporary fast mode and its combined-coverage exemption remain unchanged; no measured coverage is claimed.
