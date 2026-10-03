# Notification template and delivery-window form batch — October 4, 2026

Status: built, reviewed and locally verified. Publication and exact-head CI are read back separately.

## Scope

This batch advances `02-auth-users-admin.md#T-09.04.01`, `02-auth-users-admin.md#T-09.06.03`, `07-ui-ux-design.md#T-07.30.02.05` and the shared form tasks `07-ui-ux-design.md#T-07.10.01.02`, `.04`, `.05`, `.06`. The global all-form tasks remain partial.

- Template create/edit uses the existing deferred shared form framework: touched validation, linked bilingual feedback, first-error focus, retained input and an immediate submission lock. Event/channel/language, subject/body placeholders and variable metadata validate before writes. Established variable deduplication, published-version immutability, drag/keyboard insertion, preview and self-test behavior remain.
- The delivery-window editor retains raw minute inputs and its accepted config through failed/malformed reads. Changed saved values withdraw captured work and require explicit reset. Permission loss clears private work, and obsolete callbacks cannot restore it. Existing same-day/minimum-four-hour rules, fallback timezone and newly-scheduled-only worker semantics remain.
- Both forms map only owned server field identifiers. Zod boundaries still run after controller permission checks; merged template validation remains inside the mutation transaction. Raw placeholder names and validator messages are not returned. Existing partial edits and step-up/session/CSRF/audit checks remain.
- Save receipts must match captured values. Unverified writes freeze submission until authoritative refresh and explicit reset. A read started before an outstanding delivery-window write finishes cannot verify that write: another refresh after settlement is required.
- Unverified protected save receipts also disable another confirmation inside the open dialog. Step-up retries keep captured values; confirmation validation returns to the owning fields. Review separates validation from network ownership so an old network operation cannot block or unlock recovered template work.
- Route-only Persian/English form copy leaves the global dictionary unchanged. The variable sidebar stacks on narrow screens; native window controls use theme colors and keep clock segments left-to-right inside the Persian layout. Both Persian dark mobile forms are inspected.

## Validation

378 distinct related unit/API/dictionary cases have passing evidence, including 32 new cases: frontend 87 (27 new), API 216 (three new), dictionaries 75 (two new). Counts exclude reruns. All 50 distinct related production browser scenarios have passing evidence, including 20 new (16 language/theme scenarios and four migrated real-API flows). The final receipt guard and RTL-time display pass the affected browser rerun separately.

- `pnpm --filter @barghsa/web test src/pages/notification-forms.test.tsx src/lib/notification-form.test.ts src/components/delivery-window-forms.test.tsx src/pages/content-catalogue-recovery.test.tsx src/pages/delivery-provider-recovery.test.tsx src/components/TemplatePreviewPanel.test.tsx src/components/NotificationDeliveryHistory.test.tsx` — 87 pass. Recovery fixtures wait for deferred validation before starting network races; focus assertions await the actual scheduled focus.
- `pnpm --filter @barghsa/api test src/admin/notification-template-boundaries.test.ts src/notifications/notification-template.service.spec.ts src/notifications/notification-template-http.integration.test.ts src/notifications/notification-template-delivery.test.ts src/admin/config-write-http.integration.test.ts` — 216 pass. Actual HTTP checks verify safe subject/body/start-time field names and no writes on rejected input; authority, immutable publishing, delivery and minute scheduling regressions remain covered.
- `pnpm --filter @barghsa/i18n test` — 75 pass.
- `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e 'notification-forms.spec.ts|notification-template-authoring.spec.ts|notification-template-recovery.spec.ts|notification-template-versions.spec.ts|admin-settings-live.spec.ts' --grep 'template|delivery window' --grep-invert 'contract template UI' --project=chromium --project=mobile-safari --workers=1` — 50 pass. The old create-recovery fixture now refreshes/resets after an unverified receipt before retrying. Axe covers form controls and excludes the separately rendered email-preview iframes; iframe previews retain their existing tests.
- `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e notification-forms.spec.ts --grep 'feedback, captured retry' --project=chromium --project=mobile-safari --workers=1` — final affected browser run 8/8 pass. Persian dark mobile clocks now display the correct hour/minute order.
- Root build (seven tasks), types (11 tasks), lint, OpenAPI contract and suppressed-error checks pass. All 84 unchanged gzip budgets pass: shared catalogue validation 14.84 KB/20 KB and the full notification route 400.88 KB/500 KB. Strict SAST passes all five fixtures and scans 1,586 files with zero findings/parser errors. Final formatting/backlog/staged-diff checks precede publication.

## Remaining work and limits

Email/SMS provider configuration forms remain candidates. Consultation auto-assignment remains an unfinished part of the staff-team parent. No dependency, migration, endpoint, CI-setting, generated queue/ledger, scheduler or historical supervisor-state change.

An initial broad browser selector accidentally included unrelated contract-template live smokes: English timed out while waiting for the “Add template” button and Persian also failed. That run was interrupted, and those tests are a recorded follow-up; no full-browser-suite success is claimed. The preceding staff-team commit `9562a4da` has three successful CI gates with tests still running when last checked; it is not reported green.
