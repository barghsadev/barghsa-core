# Terms and contract-template forms, October 4, 2026

## Kanban scope

This batch advances `07-ui-ux-design.md#T-07.10.01.02`, `.04`, `.05` and `.06` across two related staff content editors. Canonical domain context is `02-auth-users-admin.md#T-09.03.01`, `#T-09.03.02` and `#T-09.12.04`. Existing terms publication, version history and contract-template storage are not counted as newly implemented. Global form parents and other configuration/AI editors remain partial.

## Behavior and review

Terms version IDs, both language documents, and contract-template names, descriptions and status use the existing deferred shared form validation. Touched fields expose bilingual owned feedback, linked error IDs and first-error focus. Valid companion text stays intact through validation and server failures. Submission locks start synchronously; unavailable validation preserves drafts and permits retry. Protected template confirmation preserves its captured command and returns owned server errors to the editor.

Fresh template metadata retains local edits until explicit reset and withdraws obsolete confirmation. Unknown mutation receipts, server failures and lost responses require authoritative recovery and explicit reset before more writes. Terms retain expected-revision guards, single-draft constraints, publication previews, material-change consent, immutable versions, permission ordering and transactional audits. Template permissions, step-up, UTF-8 upload validation, append-only versions, placeholder extraction and deletion constraints remain.

Review fixes enum checkbox registration and initial template hydration before editing. Safari tracing showed blur feedback moving the Save button during a tap, preventing submission; reserved feedback space keeps its target stable, and invalid focus waits for the unlocked DOM commit. Own upload receipts establish the refresh baseline so sequential uploads do not discard unrelated metadata. Explicit terms resets remount both rich editors; conflict and uncertain states freeze rich text as well as native fields. Passing translated copy from the page into the lazy widgets removes an accidental dependency on the complete page/form chunk. The editor measures 141.74 KB/170 KB and preview 26.50 KB/50 KB, with existing limits unchanged.

API validation exposes only known public field names after permission checks, rejecting whitespace-only terms without storing content or raw validation messages in errors. Endpoint paths, storage, migrations and dependencies are unchanged. Deploy the additive field-error responses with or before the frontend.

## Validation

There is passing evidence for 632 distinct related unit/API/dictionary cases, including 23 new: 501 web cases (380 boundary regressions plus 121 affected cases), 54 API cases including real HTTP/database terms tests, and 77 dictionary cases. The new cases comprise 14 editor cases and nine API cases. The final affected 35 unit cases pass after the Safari correction.

All 70 distinct related production Chromium/mobile Safari cases have passing evidence, including 12 new and eight complete migrated-API flows. The final affected run passes 16/16; 34 unchanged terms cases and 20 unchanged template recovery/retry cases reuse earlier passing evidence. The earlier larger runs contained failures and are not represented as whole-run successes. Both languages/themes, RTL, first-error focus, retained drafts, missing/deferred validation, recovery, step-up, Axe and mobile bounds are exercised. Persian dark form captures are visually inspected; locator captures can be clipped by the mobile sticky shell and are not complete-page screenshots.

Root build (seven tasks), types (11 tasks), lint, contract/suppression checks and backlog validation pass. All 84 existing bundle budgets pass; strict security scans five rule fixtures and 1,594 files with zero findings and zero scanner errors. Final formatting and staged-diff checks precede publication. Backlog validation confirms 1,355 tasks and 116 traceability entries. No scheduler, generated queue/traceability ledger, historical supervisor snapshot or external state changes are included.

## CI reconciliation

Provider commit `b46cd23249f467d978b8097792ee444ae0d25fb5` [CI run 37156267187](https://github.com/barghsadev/barghsa-core/actions/runs/37156267187) failed three web cases; its combined-coverage gate also failed after tests failed. The two SMTP mocks returned the old label after an update, and the API mock reused an already consumed Response across requests. These fixtures now echo the saved label and return a fresh Response. All 380 boundary cases and all 29 provider request cases pass; production receipt and denial guards remain unchanged. The earlier contract-template live fixture follow-up is repaired by using persisted locale and owned alert locators; terms live fixtures receive the same locale correction. The template mobile-bounds assertion now polls for layout after resizing, retaining the same no-overflow requirement. No CI setting or check is disabled.

## Commands and evidence

- `pnpm --filter @barghsa/web test src/pages/content-forms.test.tsx src/pages/AdminTosDraft.test.tsx src/pages/content-catalogue-recovery.test.tsx src/pages/contract-settings-recovery.test.tsx src/components/TeamActionDialog.multipart.test.tsx src/lib/email-providers-api.test.ts` — 121/121; `/tmp/barghsa-content-web-publication2.log`.
- `pnpm --filter @barghsa/web test` with the five editor/dialog files above plus `src/pages/admin-boundaries.test.tsx` — 472/472 before the final focus adjustment; the affected 92 cases pass again, and the 380 unchanged boundary cases are reused.
- `pnpm --filter @barghsa/api test src/admin/tos-http.integration.test.ts src/admin/contract-template.controller.test.ts src/admin/contract-template.service.test.ts` — 54/54; `/tmp/barghsa-content-api-tests.log`.
- `pnpm --filter @barghsa/i18n test` — 77/77; `/tmp/barghsa-content-i18n.log`.
- `pnpm --filter @barghsa/web test src/pages/content-forms.test.tsx src/pages/contract-settings-recovery.test.tsx` — 35/35 after the final Safari layout/focus correction; `/tmp/barghsa-content-layout-unit.log`.
- Production browser commands set `BARGHSA_TEST_PREBUILT=1` and `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173`, with `--project=chromium --project=mobile-safari --workers=1`.
- Final `pnpm --filter @barghsa/web e2e 'content-forms.spec.ts|admin-settings-live.spec.ts' --grep 'content forms|content unverified|contract template UI'` with those browser options — 16/16; `/tmp/barghsa-content-layout-browser.log`.
- Earlier terms run: `e2e 'content-forms.spec.ts|content-catalogue-recovery.spec.ts|form-accessibility.spec.ts|admin-settings-live.spec.ts' --grep 'content forms|TOS |terms publishing'` — 34 terms cases pass; four Safari combined-form failures are repaired and covered by the final run. `/tmp/barghsa-content-browser-publication.log`.
- Earlier template run: `e2e 'content-forms.spec.ts|content-catalogue-recovery.spec.ts|contract-settings-recovery.spec.ts|contract-templates.spec.ts|form-accessibility.spec.ts|admin-settings-live.spec.ts' --grep 'content forms|content unverified|\\bTOS\\b|terms catalogue|template metadata|template confirmation|template editor retries|contract template UI'` — 20 unchanged recovery/retry cases pass; all selected new/live cases pass in the final run. `/tmp/barghsa-content-browser-final.log`. The escaped TOS pattern selected no terms cases; terms evidence comes from the separate run above.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`.
- Final root build/types/lint/bundle evidence: `/tmp/barghsa-content-layout-{build,types,lint,budgets}.log`. Contract/suppression evidence: `/tmp/barghsa-content-{contract,suppression}.log`.
- Pinned strict scan: `PATH=/Users/majid/.cache/barghsa-security-scanner-313/bin:/usr/local/bin:/usr/bin:/bin python3 scripts/check-sast.py --report /tmp/barghsa-content-layout-sast.json` — pass; `/tmp/barghsa-content-layout-sast.log`.
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`.

## Publication and remaining work

Publish directly to main after final checks, with normal push, SHA agreement, clean checkout and exact-head CI registration read back. No PR is created. Remaining staff content/configuration and AI forms are candidates; the all-form parent tasks remain partial.
