# Session and trusted-device settings forms

Date: October 5, 2026. Manual batch under the user's build/review/related-tests/direct-main workflow. No pull request is created.

## Scope and completion boundary

Batch single other-session revocation, password-confirmed revocation of all other sessions and removal of device trust as three bilingual native forms. Reuse existing session engines from `02-auth-users-admin.md#T-02.02.01` and `#T-02.02.02`; they are not recounted as new backend tasks. Advance `07-ui-ux-design.md#T-07.10.01.02` through `#T-07.10.01.06` in this family; these global parents remain partial.

## Delivered behavior

React Hook Form owns raw password drafts and linked field errors with deferred shared validation. Empty required passwords focus the native field before any POST. Known password or validation rejection preserves the exact entered value and uses translated feedback without displaying private backend messages. The selected target is captured separately from source lists; encoded target IDs, actual receipt shapes and exactly one current session gate actions and read confirmation.

A shared synchronous page owner precedes validation, writes and explicit refreshes. Competing native/synthetic submissions, session/trust controls, dialog cancellation and timestamp retry consult that owner. The existing opaque account identity and profile-context revision fence reads, validation and late write callbacks. Denied current reads retire both private lists and the dialog. Transient or malformed source reads remain retryable.

Actual password verification rotates session, refresh and CSRF cookies. A successful complete step-up receipt is followed by an authorized session read before the target DELETE, with replacement CSRF read when that DELETE is sent. Trust removal also refreshes its target list and leaves existing sessions active. Single-session and trust removal require their actual 200 receipts; revoke-all additionally requires an authorized read proving that only the current session remains. Session device/location/date display helpers retain their original bytes.

All mutations remain unkeyed. Unknown or malformed outcomes hold ownership and offer read-only confirmation. Desired current state proves completion without another write. A valid mismatch enables deliberate return to editing, preserving password and selected target; a new pending recheck synchronously invalidates older restart eligibility. Password verification has no public confirmation endpoint, so an unknown verification never automatically continues to a DELETE. Read proof establishes current state, not which actor caused it.

## Review and corrections

Root source review grounds behavior in the unchanged session, trusted-device and password-verification controllers/services, including account/session locks, current CSRF, original expiry limits, replacement-session step-up stamps, ownership and transactional audits. This batch does not claim an independent agent or Codex CLI review.

The first browser run exposes insufficient active destructive-button contrast, incomplete legacy branding prerequisites, stale recovery assertions and new tests locating background controls through a modal's hidden state. Local revoke-button colors are corrected; the fixtures use actual branding/account/background prerequisites, explicit confirmation reads and retained password assertions. Denied source cases verify private-state retirement and recovery after an explicit page reload. Existing country-estimate cases remain. The final rerun passes all 32 cases. The complete first result set, failure traces and all 74 result files are preserved before the rerun.

SAST initially flags a literal synthetic rejected credential in a test expectation; the fixture constructs its non-secret sample without changing scanner rules or suppressing findings. All five rule fixtures and the corrected scan pass. An early budget invocation races the build's manifest writer and fails with a missing manifest; completed-build verification then passes all 85 unchanged budgets. Failed logs and statuses are retained.

## Validation and publication

All fifteen distinct selected source/dictionary cases pass: four adapter/receipt cases, ten native form cases and one bilingual parity case. Repeated source runs overlap this total. Build (seven tasks), root types (eleven tasks), final web types, scoped lint/format, contracts, suppressed-error checks, all eighty-five unchanged size budgets and strict SAST pass. SAST scans 1,763 files with zero findings/errors and five passing rule fixtures. All 170 protected paths remain byte-identical. Canonical backlog validation passes for 1,355 tasks and 116 traceability entries.

All thirty-two distinct browser cases pass on final assets in one zero-retry run: eight new session/revoke-all stories and twenty-four retained trusted-device/source/location cases on Chromium and mobile Safari. New stories use English light and Persian dark; retained stories cover both themes in both languages. There are no skipped or flaky cases. Assertions cover native validation/focus, raw values, captured targets, replacement CSRF, read-before-DELETE, synchronized ownership, uncertainty recovery, denied reads, accessibility and viewport overflow.

Sixteen compact dialog captures are reviewed at original resolution. This certifies the pictured dialog framing, not a full-page or native keyboard/password-manager review. Eight retained trusted-device screenshots are preserved separately. Final source and built-asset hashes, reviews, commands and exact publication readbacks are bound in `/Users/majid/.local/state/barghsa-manual-batches/session-and-trusted-device-settings-forms/`.

The preceding preference commit `b9b7c87c3ea29671cc155df1c06bcb295c49c414` completed all five CI jobs successfully: <https://github.com/barghsadev/barghsa-core/actions/runs/37304370822>. This batch is published only after passing local checks and source/pixel review; its own remote CI is reported separately after the exact commit exists.

## Remaining work

Continue the next coherent native-form family after inspecting actual API authority and current kanban context. Global validation, interaction, accessibility and performance parents remain partial; no generated queue/coverage ledger, CI, dependencies, backend policy, schema/migration or scheduled supervisor state is changed by this batch.
