# Admin configuration audit timelines, October 1, 2026

## Kanban scope

This batch completes `07-ui-ux-design.md#T-07.30.01.05`. The shared AuditLogViewer serves branding, OTP expiry and service response targets. Each expandable entry shows the event, version when recorded, author, timestamp and approved old/new field values.

The next authentication batch is `07-ui-ux-design.md#T-07.30.01.06`. Its specified OTP step-up for provider configuration, refund thresholds and role changes remains open. The current password confirmation does not complete that requirement. Broader form adoption and remaining domain journeys remain separate work.

## Behavior and review

The new read-only `/api/admin/config/audit` endpoint enforces the existing permission for each settings scope. It rechecks current account/grant authority and the session inside its transaction, including session expiry after a blocked query. Pagination uses descending microsecond timestamps and audit IDs, with scope-bound cursors. Only allowlisted scalar fields reach the client; credentials, IP addresses and raw metadata are excluded.

Branding saves and activations record the actual previous and new configuration inside the existing serialized write transaction. An audit failure rolls back the configuration write. Older branding events can recover their immutable current configuration, while missing previous values explicitly remain unrecorded. Malformed legacy metadata cannot break reads.

Opening the viewer requests history independently from the editor. Failed reads retain accepted entries and expanded details. Pagination retries the exact failed cursor, deduplicates overlap and rejects cursor cycles. A verified settings revision refreshes the first page. Permission denial clears private history and parent work. Request generations also prevent a late OTP save receipt from restoring cleared work after denial, cancellation or unmount.

Review fixed a UUID-to-text legacy join, invalid calendar dates, safe legacy JSON handling and mixed RTL author wrapping. The generated OpenAPI change adds only this endpoint, including a bounded response schema. Native details controls support keyboard use. Both dictionaries, responsive layout, Axe checks and Persian mobile light/dark rendering are verified. No database schema, migration or dependency changes are included.

## Validation

The full web suite passes 1,738 cases. The final affected run passes 451 cases across six files, including three additional late-response cases. Together they provide passing evidence for 1,741 distinct web cases, not a separate full-suite run of 1,741.

All 44 distinct relevant API cases have passing evidence. The final PostgreSQL HTTP run passes all five cases covering scope authorization, malformed input and legacy data, session expiry during a locked query, exact pagination and transactional branding audit rollback. The other 39 API cases pass in the related run. All 12 shared contract cases and 53 dictionary cases pass. Failed and repeated runs are excluded.

All 56 final production browser scenarios pass across Chromium and mobile Safari, both languages and themes. They cover the three audit adoptions, existing versioned branding saves/activation, OTP password confirmation and target recovery. Keyboard expansion, retained drafts and entries, permission denial, Axe and mobile bounds pass.

Root build/types/lint, final API build/lint, formatting, contract/suppression checks and all 64 route budgets pass. Backlog validation passes 1,355 tasks and 116 traceability entries. The pinned strict security scanner passes five fixtures and scans 1,343 files with zero findings or scanner errors. Diff checks pass.

## Publication

The preceding versioned-settings commit is `2ccc7c16b0fff246aaf86b39bec10626fbecb76c`. Its CI run [36859625381](https://github.com/barghsadev/barghsa-core/actions/runs/36859625381) succeeds under existing temporary fast mode. Combined coverage remains an exemption, not measured coverage.

This batch is committed and pushed directly to main after local validation. Remote SHA, clean worktree and exact-commit CI registration are read back after publication. No PR is created. Historical supervisor state, external handoffs, scheduler and CI gates remain unchanged.

## Commands

- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `pnpm --filter @barghsa/api build`; final affected API lint
- `pnpm --filter @barghsa/web exec vitest run`
- Final web rerun with `src/components/AuditLogViewer.test.tsx src/components/otp-audit-boundary.test.tsx src/pages/branding-settings.test.tsx src/pages/assignment-settings-recovery.test.tsx src/components/SettingsFormSection.test.tsx src/pages/admin-boundaries.test.tsx`
- `pnpm --filter @barghsa/api exec vitest run src/admin/config-audit.test.ts src/admin/config-audit-http.integration.test.ts src/admin/branding-boundaries.test.ts src/admin/service-targets-http.integration.test.ts`; final HTTP-only rerun
- `pnpm --filter @barghsa/shared exec vitest run src/admin/config-audit.test.ts`; `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs config-audit.spec.ts versioned-settings.spec.ts otp-config.spec.ts assignment-settings-recovery.spec.ts --grep 'settings audit recovery|version review|OTP settings|targets recovery' --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `pnpm contract:update`; `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper using `--timeout 60 --jobs 2`, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
