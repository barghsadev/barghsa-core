# Password recovery native forms

Date: October 5, 2026. Manual batch under the user's build/review/related-tests/direct-main workflow. No pull request is created.

## Scope and completion boundary

Batch recovery destination entry, OTP verification and new-password/confirmation as three bilingual native stages. Reuse `02-auth-users-admin.md#T-02.03.01` and `#T-02.03.02`; existing recovery engines are not recounted. Advance `07-ui-ux-design.md#T-07.10.01.02` through `#T-07.10.01.06` in this family; these global parents remain partial.

## Delivered behavior

React Hook Form owns raw destination, code, password and confirmation drafts. Deferred validation checks the active stage, links native field errors and focuses the first invalid field before I/O. The original Iranian/international/email normalization algorithm retains its bytes apart from the exported function name. Known rejection preserves exact entered values and shows translated feedback without private backend details.

A synchronous owner precedes deferred validation and every public-auth action. Actual anti-enumeration challenge receipts, challenge-bound expiring grants and complete reset acknowledgements gate stage changes and secret cleanup. Duplicate submissions, resend, old form callbacks and same-frame restart consult current authority. Unmount, draft generation and grant expiry fence late results. OTP form binding adds optional name/ID/change events; existing login/registration callers and input algorithms remain.

Unknown network, malformed-success or server-error results hold the draft and offer an explicit new recovery. No public endpoint can confirm a consumed OTP or uncertain reset, so no blind replay or invented confirmation read is added. Restart retains only raw destination and existing cooldowns. Password, code and authorization are never written to storage or URLs. Existing pre-auth CSRF, separate resend/attempt cooldowns, password history, expiry, transactional audit and session/refresh revocation policies remain unchanged.

## Review and corrections

Root source review finds and closes a same-frame retired reset-token submission after explicit restart. A targeted regression verifies zero extra POSTs. This batch does not claim an independent agent or Codex CLI review.

The first 50-case browser run passes. Production budget verification then exposes a lazy-route back dependency and a missing auth manifest entry. Validation predicates are passed into the deferred schema and the hook reuses the existing public-auth error helper; all 85 unchanged budgets pass. No budget, Vite, dependency or CI setting changes.

After widening captures to include notices outside the form, a subsequent run passes 49 cases and exposes a mobile validation race: a blur overlapping an invalid submit can clear feedback after owner release. Validation is bound to draft generation rather than transient ownership; grant transition retires old validation. A native blur-overlap case is added, and the complete final 50-case browser matrix passes. Initial logs, failed trace and all result bytes are preserved before reruns; no assertion is removed.

## Validation and publication

All 17 distinct selected source/dictionary cases pass: four pure receipt/schema cases, twelve native form cases and one dictionary parity case. Build (seven tasks), root types (eleven tasks), scoped lint/format, contracts, suppressed-error checks, all 85 unchanged budgets and strict SAST pass. SAST scans 1,768 files with zero findings/errors and five passing rule fixtures. All 173 protected paths remain byte-identical. Canonical validation passes for 1,355 tasks and 116 traceability entries.

All 50 distinct Chromium/mobile Safari cases pass in the final zero-retry run: eight new bilingual native/recovery stories and 42 retained reset/OTP/cooldown/acknowledgement cases. No cases are skipped or flaky in that run. Assertions cover raw values, linked validation/focus, actual normalized requests and pre-auth CSRF, captured grants, duplicate ownership, uncertainty/restart, expiry, secret cleanup, accessibility and viewport overflow.

Sixteen compact recovery-panel captures, including rejection and uncertainty notices, are reviewed at original resolution in English light and Persian dark. This certifies pictured panels, not full-page layout or native keyboard/password-manager behavior. Final source/assets, reviews, preserved failures, commands and publication readbacks are bound externally in `/Users/majid/.local/state/barghsa-manual-batches/password-recovery-native-forms/`.

The preceding session/trusted-device commit `2f48b80caabbe86733132a4973e1046d63470a0c` completed all five GitHub CI jobs successfully: <https://github.com/barghsadev/barghsa-core/actions/runs/37306324586>. This batch's own exact-commit remote CI is reported separately after publication.

## Remaining work

Continue registration and its code-verification forms as the next coherent family, followed by login/password-change/OTP native stages. Global form parents remain partial. No backend, schema/migration, financial/auth/session policy, dependency, CI, generated queue/ledger or historical/external supervisor state is changed.
