# Content publishing catalogue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage composition for notification templates and terms-of-service version history, including draft, preview and confirmation recovery. Existing template authoring and terms version-management domain tasks are not counted as newly built. The all-list parent, remaining filter URL/search/sort criteria and broader delivery-panel work remain partial.

## Behavior and review

Accepted template and terms catalogues survive read failure and retry. Editor text and password confirmation remain available while required reads pause commands. Fresh saved template metadata requires explicit reset of local text and withdraws obsolete confirmation. Terms draft revisions preserve local text until explicit reload; a changed draft or published comparison invalidates the publication preview. Permission denial clears private catalogue, editor, preview and confirmation work. Delayed reads and commands cannot restore withdrawn work, and React strict effect replay remains supported. Review also fixes the sample-preview heading order and request ownership of busy state: a recovered editor can start a new command without an old request blocking or unlocking it.

Template DTOs now validate complete dates/author metadata, safe identifiers, variables and status/active state, with unique catalogue IDs. Valid save/publish/archive receipts must match reviewed identity, family and content. Accepted receipts supersede older catalogue requests and remain available if authoritative refresh fails. Delete requires HTTP 204 in both direct and password-confirmation paths. The shared action dialog has an optional expected success status; other callers keep their existing behavior. Terms retain their server expected-revision protection and exact receipt validation.

Template filtering replaces only template work; independent delivery panels stay mounted so unrelated edits are preserved. Shared buttons, wrapping form controls and named keyboard-focusable table regions support both languages and narrow screens. Existing template browser fixtures use authenticated staff context, persisted locale and complete DTOs. Terms fixtures retain their timezone-error assertions while using authenticated staff context. Rich-text formatting tests use native Select All to avoid caret-dependent partial selection in the Persian layout. Initial terms errors retain localized dismissal and HTTP-status details.

No backend, database, dependency, scheduler or CI configuration changes are included. Template invalidation uses accepted metadata, without adding a server version-lock protocol. Terms continue to use their existing server revision checks. New accessibility checks cover in-app template catalogue/editor controls and terms catalogue/editor controls, modal content, and the full page after denial removes private panels. Existing email-preview iframes are outside these new scoped scans; email authoring/recovery/version behavior remains covered by the existing browser cases. Base UI external VoiceOver focus sentinels remain outside the modal-content scan.

## Validation

Final production build, root typecheck/lint/format, contract/suppression checks and all 64 route budgets pass. All 430 related web cases and 53 dictionary cases pass. All 72 distinct production browser scenarios pass across the final recovery, selected legacy terms and affected authoring/version runs in Chromium and mobile Safari. Failed and repeated cases are excluded. Both languages/themes, scoped catalogue/modal Axe, full-page Axe after denial, keyboard navigation, mobile bounds and Persian rendering are verified. The pinned security scan passes five rule fixtures and scans 1,323 files with zero findings or scanner errors. Backlog validation covers 1,355 tasks and 116 traceability entries; diff checks pass.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/content-catalogue-recovery.test.tsx src/pages/AdminTosDraft.test.tsx src/components/TeamActionDialog.multipart.test.tsx src/hooks/useCatalogueResource.test.tsx src/pages/admin-boundaries.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs content-catalogue-recovery.spec.ts notification-template-recovery.spec.ts notification-template-authoring.spec.ts notification-template-versions.spec.ts --project=chromium --project=mobile-safari --workers=1`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs form-accessibility.spec.ts --grep '\bTOS\b|terms error dismissal' --project=chromium --project=mobile-safari --workers=1`
- Final authoring rerun: `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs form-accessibility.spec.ts notification-template-authoring.spec.ts notification-template-versions.spec.ts --grep 'TOS rich text|template authoring|preview selector' --project=chromium --project=mobile-safari --workers=1`
- Pinned external scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-content-static-security-final.json` with its environment on PATH; the external local wrapper adds `--timeout 60 --jobs 2` after default-timeout errors on four unchanged large files. Strict rules, targets and exclusions remain unchanged
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

The preceding gift-code batch is published as `466acda9ff6eee4f6325e4181f8acba05d567098`. CI run `36846226007` passes all five jobs under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This batch is published directly to main following validation. No PR is created; historical supervisor state remains unchanged. Remote SHA and GitHub CI registration are read back after the push; the next batch records its immutable publication and completed CI status.

Published as `c8d0aee6265540bea8c764d4f9dc09d04c98de57`; remote SHA and clean worktree were verified. CI run `36849225318` passes all five jobs under the existing temporary fast mode.
