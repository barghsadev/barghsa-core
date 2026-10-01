# Gift-code catalogue and editor recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage toolbar/content/cursor composition for gift-code administration, including catalogue, usage-detail and confirmation recovery. Existing domain list and usage work under `03-core-business.md#T-03.02.02.02` and `T-03.02.02.05` is not counted as newly built. The all-list parent and remaining filter URL/search/sort work remain partial.

## Behavior and review

Independent catalogue and usage-detail reads preserve accepted codes, history and local editor fields during transient failure. Next-page retry uses the same UUID cursor, merges unique rows and rejects repeated cursors. Changed filters and permission epochs discard older pages. Unmount invalidates outstanding requests. Shared toolbar recovery remains available after initial failure or denied access. Review fixes a Safari focus race by keeping the outside recovery target enabled while concurrent reads finish.

Strict DTO checks cover code settings, financial strings, usage counters, valid dates, pagination size/uniqueness and bounded usage history tied to the selected code. Profile-option responses are checked before rendering; denied list, detail, profile-option or command access clears private rows, drafts and confirmation. Delayed responses cannot restore withdrawn work.

Settings comparisons use explicit ordered fields and ignore usage-only changes. Fresh saved settings invalidate pending confirmation while retaining the local draft until explicit reset. Required reads pause confirmation and preserve password input during recovery. Save/toggle receipts must match the reviewed code and proposal, including normalization, dates and unordered selections. A valid receipt supersedes older reads before authoritative refresh; failed refresh retains that receipt and disables further commands. Malformed receipts leave the editor open without reporting success. Existing password step-up and CSRF behavior remain supported.

Persian and English recovery strings, keyboard confirmation/focus return, mobile field bounds and light/dark rendering are covered. Existing gift-code browser fixtures now use authenticated staff context, persisted locale and complete current DTOs. No backend, database, dependency, scheduler or CI configuration changes are included. Client invalidation uses accepted metadata; no server version-lock protocol is introduced. Modal-content Axe excludes Base UI's external VoiceOver focus sentinels; full-page Axe runs after closing.

## Validation

Final related web validation passes 409 cases: 26 new recovery/DTO cases, the existing gift-code management case, shared receipt/race and multipart dialog cases, and 380 admin-boundary cases. All 53 dictionary cases pass. Root build/typecheck, root plus final affected-file lint, contract/suppression and all 64 route budgets pass. Fourteen distinct production browser scenarios pass across the full run and final affected eight; failed/repeated cases are excluded. Both languages/themes, modal-content/full-page Axe, keyboard focus, mobile field bounds and Persian screenshots are verified. Final formatting/backlog/diff checks pass. The pinned security scan passes five rule fixtures and scans 1,321 files with zero findings or scanner errors. No full-web-suite or measured combined-coverage claim is made.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/gift-code-recovery.test.tsx src/pages/admin-gift-codes.test.tsx src/hooks/useCatalogueResource.test.tsx src/components/TeamActionDialog.multipart.test.tsx src/pages/admin-boundaries.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs gift-code-recovery.spec.ts gift-codes.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Pinned external scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-gift-static-security-final.json` with its environment on PATH
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

The preceding inbox batch is published as `72d102d37192a6490344649bf5d1a98d5e1d2249`; CI run `36844817822` passes all five jobs under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This batch is published directly to main after final validation, with remote SHA, clean-worktree and CI registration readback. No PR is created; historical supervisor state remains unchanged.
