# Staff account, role and permission lookup forms

Status: built, reviewed and locally verified. Direct-main publication, exact-commit CI, staging deployment and Telegram receipts are recorded separately outside the checkout.

## Kanban scope

This batch improves the existing staff-account interface for `02-auth-users-admin.md#T-10.01.01` and role/effective-permission interface for `02-auth-users-admin.md#T-09.05.01`. It advances the shared form tasks `07-ui-ux-design.md#T-07.10.01.02`, `#T-07.10.01.04`, `#T-07.10.01.05` and `#T-07.10.01.06`; those global tasks remain partial.

- Staff creation validates email/E.164 phone, required names, available roles and activation method. Phone accounts retain the existing temporary-password option; activation links still require email.
- Role selection and change reasons validate before the existing OTP confirmation. The effective-permissions lookup validates blank IDs before requesting data; opaque identifiers remain supported.
- Raw drafts survive local/API rejection. Owned bilingual errors link to their controls, the first invalid field receives focus after controls unlock, and validation has a spinner and synchronous ownership.
- Existing access checks, activation, OTP, CSRF, role-change session revocation, audit history, pagination retirement and authoritative read recovery are retained. The API adds public field identifiers after permission checks using the existing exception/filter. The invalid-username error stays compatible.

## Review and verification

Root source review and failing/passing regressions corrected focus after disabled controls unlock. Visual review found a cramped mobile permissions lookup; its input now occupies a full row on narrow screens, with a new feedback-width assertion. The retained directory test helper waits for the newly asynchronous role validation without removing assertions.

- Frontend: **424 distinct cases pass** across `staff-access-native-forms.test.tsx`, `staff-directory-recovery.test.tsx`, `admin-boundaries.test.tsx` and `policy-catalogue-recovery.test.tsx`, including ten new bilingual form cases.
- API: **35 cases pass** across staff creation, sensitive actions, effective permissions and the four new public-field/authorization cases. Existing HTTP suites use actual temporary PostgreSQL fixtures.
- Dictionaries: **112 cases pass**.
- Production browser checks: **24 distinct Chromium/mobile Safari cases pass with zero retries**. The final mobile layout adjustment passes all four affected lookup cases on the rebuilt assets; these overlap the 24. Retained creation, OTP/CSRF, history and activation-resend scenarios pass.
- Root build/type checks, scoped ESLint, contract and suppression checks pass. All **85 unchanged bundle budgets** pass. Strict SAST scans **1,784 files**, with zero findings/errors and all five rule fixtures passing. Formatting and canonical backlog validation precede publication.
- Selected original Persian/English desktop/mobile captures were inspected. Compact creation captures clip offscreen lower content, especially WebKit's tall element capture; they are excluded from release attachments. Complete role and final lookup captures provide the release screenshots. These use sample records, as disclosed in Persian release notes.

Logs, initial failures, browser artifacts, source/asset hashes and review records are in `~/.local/state/barghsa-manual-batches/staff-access-native-forms`. `v0.1.1` is the batch release. Deployment uses the required `./deploy/staging/deploy.sh`, then confirmed Persian notes and selected screenshots are sent to Barghsa Release Radar.

The first publication's [CI run 37327727242](https://github.com/barghsadev/barghsa-core/actions/runs/37327727242) found two retained permission-lookup tests asserting before deferred schema validation finished. Both failures reproduce in separate cold test processes. The tests now wait inside React `act` for the actual lookup request, then retain their existing malformed-response, privacy and accepted-result recovery assertions. The 380-case boundary suite and 15-case policy recovery suite pass separately; the focused malformed-response cases also pass in a fresh process. Web type checks and scoped lint pass. This test-only repair belongs to the same unshipped `0.1.1` release; final exact-commit CI remains an external publication gate.

No existing domain engine is recounted. No schema/migration, dependency, CI configuration, generated backlog, historical loop state or supervisor state changes are included.
