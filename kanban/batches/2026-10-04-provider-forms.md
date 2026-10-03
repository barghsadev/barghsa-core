# Email and SMS provider forms — October 4, 2026

## Scope

Manual direct-main batch under the user's build/review/test/push workflow. It covers SMTP/Resend configuration and SMS.ir sender, limit, credential and template-mapping editors together. Canonical context: `02-auth-users-admin.md#T-09.06.01`, `02-auth-users-admin.md#T-09.06.02` and global form acceptance `07-ui-ux-design.md#T-07.10.01.02`, `.04`, `.05`, `.06`. These cross-product parents remain partial; this report does not mark unrelated forms complete.

## Built and reviewed

- Shared deferred validation, touched feedback, linked errors and first-error focus; unavailable validation retains the draft and blocks the write.
- Submission ownership locks synchronously before validation. Obsolete email commands cannot unlock a newer command after permission recovery.
- Drafts survive failed reads and owned server validation failures. Changed saved versions freeze the editor until explicit reset. Unverified write responses, transport failures and server errors require a fresh read and reset before another save.
- SMTP and Resend validate transport-specific fields; switching transports clears secret drafts. SMS validates available events, unique event/language pairs, positive template IDs and unique safe variable/parameter mappings. Collection feedback links to the mapping editor.
- Safe public API field identifiers map to local English/Persian messages, including protected retries. Arbitrary server text and identifiers are never rendered. Invalid email patches are rejected inside the existing authorized transaction before encryption; partial drafts and omitted secrets remain supported.
- Clearing an optional email value removes the saved public setting through a nullable update patch. Encryption, write-only blank-on-edit credentials, draft-only updates, delivery proof, testing/activation/rollback gates and atomic audit commits remain intact. The database regression verifies retained ciphertext and reset test status.
- Mobile email fields use a single column. Persian/English, RTL, both themes, field focus, Axe and mobile bounds are exercised. Persian dark mobile SMS rendering is inspected; the Persian dark mobile email form is also inspected during final verification.
- Older browser fixtures now exercise current OTP approval and rotated CSRF, including wrong-code rejection, and require explicit recovery after an uncertain save. Verified fixtures echo actual public saved configuration. No authentication gate or test assertion is weakened.

## Validation

All 289 distinct related unit/API/dictionary cases have passing evidence, including 32 new cases:

- `pnpm --filter @barghsa/web test src/pages/provider-forms.test.tsx src/lib/provider-form.test.ts src/pages/delivery-provider-recovery.test.tsx` — 44 cases, three files. Log: `/tmp/barghsa-provider-web-verified.log`.
- `pnpm --filter @barghsa/api test src/provider-config/provider-input-fields.test.ts src/provider-config/provider-mutation-http.integration.test.ts src/provider-config/email-provider-config.service.test.ts src/provider-config/email-provider-config.controller.test.ts src/provider-config/sms-provider-config.service.test.ts src/provider-config/sms-provider-config.controller.test.ts` — 168 cases, six files, including 111 migrated-database mutation cases. Log: `/tmp/barghsa-provider-api-final.log`.
- `pnpm --filter @barghsa/i18n test` — 77 cases, 14 files. Log: `/tmp/barghsa-provider-i18n-verified.log`.

All 94 distinct related production Chromium/mobile Safari scenarios have passing evidence, including 12 new scenarios and four complete migrated-API flows. The earlier 74-case run passed 70 cases; its four SMS creation failures were ambiguous alert selectors and pass in the final 48/48 affected run. The final selector additionally covers all 16 catalogue/OTP recovery scenarios and four new live API flows. Initial obsolete password-fixture runs were interrupted when the mismatch was identified and are not counted as successful runs.

```sh
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e 'provider-forms.spec.ts|email-provider-settings.spec.ts|sms-provider-settings.spec.ts|email-provider-recovery.spec.ts' --project=chromium --project=mobile-safari --workers=1
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e 'provider-forms.spec.ts|delivery-provider-recovery.spec.ts|email-provider-settings.spec.ts|sms-provider-settings.spec.ts|email-provider-recovery.spec.ts|admin-settings-live.spec.ts' --grep 'linked feedback|recover without loss|OTP recover|draft preserves saved|draft creation|resumes after OTP|provider forms persist' --project=chromium --project=mobile-safari --workers=1
```

Logs: `/tmp/barghsa-provider-browser3.log` and `/tmp/barghsa-provider-browser-final-affected.log`. Final renamed dictionary identifiers pass another 8/8 affected form scenarios before publication (`/tmp/barghsa-provider-browser-publication.log`). The live fixture uses an ephemeral provider encryption key and a seeded OTP-verified session; application responses are forwarded unchanged. Actual provider network delivery is not invoked by those local draft-save flows; existing delivery/lifecycle tests remain separate.

Root build (7 tasks), types (11 tasks), lint/format, contract/suppression checks and all 84 unchanged gzip budgets pass. Measured provider route is 407.26 KB / 500 KB; deferred catalogue validation is 14.85 KB / 20 KB. Strict SAST passes all five rule fixtures and scans 1,590 files with zero findings or scanner errors (`/tmp/barghsa-provider-sast-final.log`). Review renames dictionary message identifiers that collided with the literal-credential rule without adding exclusions or changing rules. A transient parser warning on unchanged `i18n/app.ts` clears in that final scan.

## Progress and remaining work

Provider editors in this batch adopt the shared form protocol. Global form parents and the broader journey plan remain partial. Continue with the remaining staff content/configuration editors as a batch. The previously recorded contract-template live fixture follow-up remains separate.

No migration, dependency, endpoint path, CI setting, generated queue/ledger, scheduler, historical loop-state, external supervisor state or handoff is changed. Backlog, formatting and staged diff are checked before publication. Direct-main publication is verified by local/remote/GitHub SHA agreement, a clean checkout and exact-commit CI registration; remote CI results are reported separately.
