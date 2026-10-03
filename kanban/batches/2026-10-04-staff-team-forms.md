# Staff-team and assignment forms — October 4, 2026

Status: built, reviewed and locally verified; direct-main publication is read back separately. Work started October 3 and finished October 4.

## Kanban scope

This batch advances `02-auth-users-admin.md#T-09.08.02` and the shared form tasks `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06`.

- Team create/edit, description, skill tags, member selection and team lead use the shared deferred validation layer. Raw drafts, linked bilingual feedback and focus survive owned server errors; removing a member clears their lead selection.
- Primary teams, strategies and ordered fallback priorities validate against active teams. Manual assignment, reorder/remove behavior and captured step-up retries are preserved.
- One synchronous owner locks both forms during validation and confirmation. Failed/malformed directory, candidate or rule reads retain accepted drafts and block writes. Changed saved bases cancel obsolete confirmations and retain dirty drafts behind an explicit reset. A first recovered rule read cannot silently replace unseen saved defaults.
- Save receipts must match captured identities and complete values. Unverified writes require authoritative recovery and explicit reset. Permission loss clears private work; old callbacks cannot cancel newer proposals or revive denied work.
- API errors expose only owned public field identifiers after permission checks. Partial updates remain supported, including lead updates validated against persisted membership inside the transaction. Audit events, step-up, member eligibility and config versioning remain intact.

## Review and corrections

Real API/browser coverage catches the difference between implicitly eligible search rows and explicitly eligible selected members. Their semantic comparison now agrees, so unchanged member reads cannot cancel a valid deletion confirmation. Actual eligibility changes still invalidate work; conflicting candidate reads remain rejected.

Rule groups register their primary control for first-error/server-error focus. Existing fixture records and receipts now match the API; accessible-name checks target form controls, and live team tests use the saved locale preference. The previous service-settings CI run [37151431769](https://github.com/barghsadev/barghsa-core/actions/runs/37151431769) failed two outdated response-target recovery tests and its dependent coverage job. Both tests now pass with current asynchronous validation and authoritative acknowledgement recovery. CI settings are unchanged.

## Validation

There is passing evidence for **729 distinct related cases**, including **39 new cases**: 533 frontend, 123 API and 73 dictionary cases. Counts exclude reruns. The frontend family run passes 531 cases; two subsequently added regressions pass in the final staff run (47/47, including all 28 new staff cases). The six matched API files pass 123/123, including permission, HTTP ownership, transaction, audit and partial-update coverage. All 73 dictionary cases pass.

- `pnpm --filter @barghsa/web test src/pages/staff-team-forms.test.tsx src/pages/staff-directory-recovery.test.tsx src/lib/staff-team-form.test.ts src/pages/assignment-settings-recovery.test.tsx src/pages/service-settings-forms.test.tsx src/pages/catalogue-forms.test.tsx src/pages/saving-catalogue-forms.test.tsx src/pages/limit-settings-forms.test.tsx src/pages/admin-boundaries.test.tsx src/components/TeamActionDialog.multipart.test.tsx` — 531 pass; final staff-only command against the first three files — 47 pass.
- `pnpm --filter @barghsa/api test src/admin/staff-team-fields.test.ts src/admin/staff-teams-config.controller.test.ts src/admin/staff-teams-config.service.test.ts src/admin/staff-teams-http.integration.test.ts src/admin/support-authority-http.integration.test.ts src/admin/config-write-http.integration.test.ts src/admin/admin-boundaries.test.ts src/common/http-exception.filter.test.ts` — 123 pass in six matched files; the last two nonexistent filters provide no additional coverage.
- `pnpm --filter @barghsa/i18n test` — 73 pass.
- `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e 'staff-team-forms.spec.ts|staff-teams.spec.ts|staff-directory-recovery.spec.ts|admin-settings-live.spec.ts' --grep 'team|routing' --project=chromium --project=mobile-safari --workers=1` — final production run **38/38 pass**, including 16 new scenarios and four real API create/rule/edit/delete flows. Both languages/themes, RTL, linked feedback/focus, captured retries, stale/uncertain receipts, independent recovery, denial, Axe and mobile bounds are covered. Persian dark mobile form inspected.
- `pnpm build` — seven tasks pass; `pnpm typecheck` — eleven tasks pass; `pnpm lint` — pass.
- `pnpm check:contract`, `pnpm check:suppressed-errors`, `python3 kanban/scripts/build_backlog.py --check` — pass; backlog remains 1,355 tasks/116 traceability entries.
- `node scripts/check-route-budgets.mjs` — all 84 measured budgets pass, retaining all 38 definitions and ceilings. Both default-gzip and Size Limit checks pass.
- Strict `scripts/check-sast.py` — all five rule fixtures pass; 1,582 files, zero findings/errors. A scanner parser limitation in the typed mock is resolved using a standard type alias, without exclusions or suppression.
- Formatting and staged-diff checks precede publication. Logs: `/tmp/barghsa-team-*`. Visual evidence: `/tmp/barghsa-staff-team-form-fa-dark.png`.

## Remaining scope

The broad staff-assignment task remains partial: consultation auto-assignment is not wired into the shared ticket/correction rules. The global shared-form tasks also remain partial; notification/configuration editors and other remaining surfaces need their own batches. No endpoint, dependency, migration, CI setting, generated queue/ledger, historical loop state, scheduler or external supervisor state change is included.
