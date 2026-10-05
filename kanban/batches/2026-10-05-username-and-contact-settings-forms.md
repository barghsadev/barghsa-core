# Username and contact settings forms

Date: October 5, 2026. Manual batch under the user's build/review/related-tests/direct-main workflow. No pull request is created.

## Scope and completion boundary

Batch paired-destination username send/verify and secondary email/mobile send/verify: four native stages with independent destination and OTP drafts. Reuse the existing account settings engine from `02-auth-users-admin.md#T-03.03.04`. Advance `07-ui-ux-design.md#T-07.10.01.02` through `#T-07.10.01.06` in this family; these global parents remain partial. Existing verification, identifier uniqueness, rate, transaction and session policies are not recounted as new tasks.

## Delivered behavior

Touched bilingual native forms retain raw destination and OTP values, existing field IDs, layout and RTL behavior. Shared deferred validation checks the captured stage before one write. Email fields use text inputs with email input mode so browser sanitization cannot silently strip raw spaces; only outgoing destinations are normalized. A synchronous page owner guards send, verify, companion editors, cancellation and refresh before deferred validation. The guard also rejects synthetic and repeated submissions.

Current opaque actor identity fences reads, writes, feedback and private drafts. A true actor change or current account authorization loss retires challenges and codes; late old-actor results cannot restore them. Same-actor transient reads preserve draft intent. An OTP rejection's 401 remains a verification error. Only explicit account authorization codes on write responses, or denied authorized account reads, withdraw private access; unknown 401 bodies remain uncertain.

Send receipts must contain the real challenge UUID and captured destination; username receipts must also match the original username. Verification accepts the actual message receipt, then requires a fresh authorized account read matching the captured username or verified contact before clearing the owning branch. The companion branch remains intact.

These APIs remain unkeyed. Unknown outcomes freeze competing work and expose an explicit account-confirmation read. A matching verification read can prove completion without a second POST. Sending cannot be proved from the account row. A valid read that does not prove completion allows a deliberate request restart, retaining the destination and companion draft while retiring only the owning challenge/codes. No automatic or blind write replay is added. Private server text is never rendered as field feedback.

## Review and corrections

Root source review checks actual unchanged controllers, DTOs and service behavior, ownership, response projections, actor retirement and recovery. This batch does not claim a separate agent or Codex CLI review. A stage guard confines editable destination errors to the send stage.

The initial native failures exposed FormControl replacing existing input IDs. Supplying the ID to FormItem restores the native label/error relationship and focus; all eleven native cases then pass. The first browser run exposed HTML email sanitization and older English fixtures being overwritten by persisted Persian locale. The email correction has a raw-value regression assertion. Two additive persisted-locale initializations repair the older fixtures; removing those statements reproduces every original test byte, preserving all assertions.

The first browser run's complete forty result files, including failing traces, are preserved before the repair run. The initial native failure status and source hashes remain, but its original detailed logs were overwritten by the subsequent driver; no complete failed-native-log preservation is claimed.

## Validation and publication

All twenty distinct source/dictionary cases pass: eight pure/schema cases, eleven native cases and one bilingual dictionary parity case. Later nineteen-case web reruns overlap this total. Coverage includes raw values, invalid focus with zero POSTs, companion preservation, synchronous ownership, actual receipts, known OTP rejection, uncertain send/verify recovery, authorization withdrawal and old-actor fencing.

All twenty browser cases pass in one zero-retry run on final production assets: eight new account stories plus twelve retained username/contact cases, using Chromium and mobile Safari in English light and Persian dark. There are no skipped or flaky cases. The sixteen original compact field/outcome captures are reviewed at original resolution. Their framing does not certify full viewports, OTP-stage screenshots, native keyboards or menus; browser assertions separately check accessibility and viewport overflow.

Build (seven tasks), root type checking (eleven tasks), scoped ESLint/Prettier, contracts, suppressed-error checks, all eighty-five unchanged size budgets and strict SAST pass. SAST scans 1,749 files with zero findings/errors and five passing rule fixtures. Canonical backlog validation passes for 1,355 tasks and 116 traceability entries. All 166 protected source/configuration paths remain byte-identical.

Exact commands, logs, source/asset hashes, review artifacts, preserved browser results, publication readback and exact-commit remote CI are recorded externally in `~/.local/state/barghsa-manual-batches/username-and-contact-settings-forms/`. Publication and remote CI remain separate receipts; local success does not imply remote CI success.

## Continuation

Notification/marketing preferences and timezone settings are the next coherent proposed family. Ground their native-form adoption in actual settings DTOs/receipts and preserve analytics consent, offered channels, time conversion and financial date policies. No backend, migration, dependency, endpoint, OTP/session policy, CI, generated queue/ledger or historical/external supervisor-state change.
