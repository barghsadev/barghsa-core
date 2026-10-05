# Login native forms and public-auth language ownership

Date: October 5, 2026. Manual batch under the user's build/review/related-tests/direct-main workflow. No pull request is created.

## Scope and completion boundary

Batch login credentials, required password change, and login OTP/device-trust/resend. Reuse `02-auth-users-admin.md#T-02.01.01` through `#T-02.01.04`; existing authentication engines are not recounted. Include the directly related registration/verification display-language ownership regression in the preceding native family. Global `07-ui-ux-design.md#T-07.10.01.02` through `#T-07.10.01.06` remain partial.

## Delivered behavior

Three React Hook Form stages retain raw username, credential, new password, confirmation, code and explicit device-trust values. Deferred current-stage validation links field feedback and focuses the first invalid control before I/O. Existing username normalization is reused. Login retains compatibility with nonempty historical passwords; required password changes enforce the actual 8–128-character uppercase/lowercase/digit policy and exact raw confirmation.

A synchronous owner captures actual public-auth commands before validation. Device trust, code verification and resend share that owner; elapsed attempt/resend deadlines gate requests independently. Existing credential, password-change, session and same-challenge resend acknowledgement predicates remain unchanged. Acknowledged transitions retire native controls and clear secrets; password changes return to credentials and require a new login without inventing a session. Known password-history rejection preserves both raw password fields. Known OTP rejection keeps the existing code-clearing policy. Owned expiry timers retire the grant after the delay and cancel on unmount.

Unknown network, server-error and malformed-success results hold their possibly consumed grants and raw drafts. Explicit fresh login clears passwords, code, trust and grants while retaining only the raw destination. No automatic replay or invented confirmation endpoint is added. Display-language changes preserve pending/unknown ownership; actual stage/challenge changes and unmount still retire it. The same narrow context correction is applied to registration and registration-code verification. Passwords/grants/codes are not put in storage or URLs. Existing pre-auth CSRF, backend expiry/history/deduplication, transactional session, trust and audit authority remain unchanged.

## Review and corrections

Root source review covers the three-stage route, native ownership adapter, deferred schemas, dictionaries, retained fixtures and actual backend contracts. No independent agent or Codex CLI review is claimed. The first product build/types and 19 initial login source/dictionary cases pass. Source review then identifies language-only context retirement clearing an unknown request lock. Two added registration regressions fail against the preceding code; both pass after the narrow context correction, alongside a login language-change regression. The exact failing log is preserved.

Retained browser cases keep normalization, raw inputs, policy bounds, secret cleanup, session/onboarding, request bodies, pending controls, accessibility and rate/CSRF assertions. Invalid input now submits to native feedback instead of remaining inaccessible behind a disabled button. Unknown-result cases require explicit fresh credential submission and a new grant/challenge before a second mutation; they retain the original two-request and receipt checks. The bootstrap-failure case keeps its no-credential-send assertion and now verifies a deliberate fresh attempt after transport recovery. No retry assertion is satisfied by reusing an uncertain grant.

## Validation and publication

All 44 distinct selected source/dictionary cases have passing evidence: three login policy cases, eighteen login native cases, four registration receipt/schema cases, seventeen registration native cases and two dictionary parity cases. Evidence is the first 40 web cases plus both parity cases, followed by eighteen final login native passes with two added expiry regressions and sixteen overlaps. The expiry-only addition changes no production or browser source. Final web types and scoped lint pass again.

Final build (seven tasks), root types (eleven tasks), lint/format, contracts, suppressed-error checks, canonical validation and all 85 unchanged bundle budgets pass. Strict SAST after the final fixture addition scans 1,778 files with zero findings/errors and five passing rule fixtures. All 198 protected paths remain byte-identical; all 486 final production asset files retain their verified hashes. Canonical validation remains 1,355 tasks and 116 traceability entries.

All 80 selected Chromium/mobile Safari cases pass in the first final-asset browser run, with zero retries/skips/flakes: eight new bilingual native stories and 72 retained login/password/OTP/rate/CSRF/registration cases. Sixteen new compact panels are inspected at original resolution in English light and Persian dark. Errors, focus, raw masking, retained trust and explicit fresh-login actions are readable. Existing strength-helper text is clipped at some compact crop edges; one English mobile OTP capture has a preceding success toast over the lower panel edge. The disabled resend and shared ownership are separately asserted. This certifies pictured panels within these limits, not full-page or native keyboard/password-manager behavior.

Commands, failures, final source/assets, root reviews, preserved browser-result bytes and direct-main readbacks are bound externally in `/Users/majid/.local/state/barghsa-manual-batches/login-native-forms/`. The preceding registration commit `8b37597404f73fe80a7290daa1fca737e20aab51` completed all five CI jobs successfully: <https://github.com/barghsadev/barghsa-core/actions/runs/37312032666>. The verified terminal result is preserved externally; this batch's own exact-commit CI is tracked separately.

## Remaining work

Check the profile lifecycle export/closure request and staff closure-review family for the next coherent native-form batch. Continue from existing engines and durable reports without recounting completed work. Global form parents remain partial. No backend, schema/migration, financial/auth/session policy, dependency version, CI, generated queue/ledger or historical/external supervisor state changes.
