# Profile lifecycle requests and staff closure native forms

Date: October 5, 2026. One manual batch under the user's build/review/related-checks/direct-main workflow. No pull request is created.

## Scope and completion boundary

Batch customer export/closure request ownership, complete blocker display, safe export preparation, and staff closure confirmation/password. Reuse `02-auth-users-admin.md#T-11.01.01`, `#T-11.01.02`, and `#T-11.01.03`. Existing request/export/closure engines are not recounted. Global `07-ui-ux-design.md#T-07.10.01.02` through `#T-07.10.01.06` remain partial.

## Delivered behavior

The customer parser previously accepted six blocker codes and rejected the actual eleven-code response. It now accepts the complete actual blocker set and validates owners, next steps, counts, request statuses, IDs and dates. Export and closure remain distinct actions, with support-thread links, existing asynchronous progress and expiry behavior. Customer actions have no input fields; no artificial customer form is introduced.

A synchronous customer owner captures the original profile, type, idempotency key and locale. Duplicate clicks, companion actions, current authorization denial and retired account/profile contexts cannot overwrite it. Unknown creation retries use the same body. Once the creation receipt is confirmed, export retries address the saved ticket; they never recreate the request. A confirmed job acknowledgement advances to an authorized matching preview read. Failed refreshes retry the read alone. Existing export preparation uses the same owner.

Staff confirmation and current password use React Hook Form with deferred validation, linked messages and first-invalid focus. Incomplete previews cannot offer approval: the actual ticket/profile/opaque owner, eleven blockers, thirteen retained counts, export references and server preview version are checked. Raw password and consent drafts survive known password rejection. Manual fresh reviews preserve the password and require renewed consent; a changed-review conflict cannot reuse the previous approval.

Only the actual step-up acknowledgement permits closure execution. Full matching completion receipts alone clear secrets and call completion; a partial success body cannot claim closure. Unknown execution retains the original dry-run version and ticket ownership, allowing an exact retry with fresh step-up. Completed replays may have a changed server preview hash, as the existing backend specifies. Companion writes remain blocked. Existing ticket-page retry markers allow this owner to retry and correct its password while the page capture guard blocks other controls.

No backend, authorization, session/OTP engine, financial/retention policy, migrations, dependencies, CI configuration or supervisor state is changed.

## Review and corrections

Root reviews the actual controller/service responses, native component ownership, deferred schema, dictionaries, retained fixtures and committed-scope boundaries. No independent agent or Codex CLI review is claimed. The existing partial preview/receipt fixtures are upgraded to complete real wire shapes and actual HTTP statuses. Native invalid input now produces linked feedback instead of an inaccessible disabled submit button. The former repeated-create export fixture now verifies one confirmed request and two export attempts.

Seven initial staff test failures occur because assertions run before the deferred schema loads; waiting for dynamic imports fixes the fixtures. One unused browser type is removed. The first browser run passes twenty of twenty-four cases. Four closure-replay cases identify an integration omission: the ticket page capture guard requires its existing retry marker. A native-button hypothesis reproduces the problem and is discarded. Diagnostics preserve the failed evidence and are removed from product/browser source. The final marker fix passes all eight affected staff cases, including a rejected step-up password correction and a committed replay with the original request body. Closure callback failures cannot turn an already verified receipt into an uncertain command.

## Validation and publication

All thirty-eight distinct selected source/dictionary/HTTP cases have passing evidence: four lifecycle proof cases, seven customer component cases, eleven staff component/coordinator cases, ten retained ticket proof cases, one bilingual dictionary case, and five existing real-database HTTP lifecycle/closure cases. The final thirty-two web cases and dictionary case pass; unchanged HTTP integration evidence is retained from the first gate run.

Final build (seven tasks), root types (eleven tasks), scoped lint/format, contracts, suppressed-error checks, canonical validation and all eighty-five unchanged bundle budgets pass. Strict SAST scans 1,782 files with zero findings/errors and five passing rule fixtures. All 214 protected paths remain byte-identical; all 488 final production assets retain verified hashes. Canonical validation remains 1,355 tasks and 116 traceability entries.

All twenty-four selected Chromium/mobile Safari cases have passing evidence: twenty initial passes plus the final eight affected staff passes, with four overlaps. This is a selective evidence union across builds, not one complete final-asset rerun. Both runs use zero retries; their failed results and all result bytes remain preserved. Sixteen selected compact captures are inspected at original resolution in English light/Persian dark. Customer crops show portions of the blocker list; mobile job progress and closure retry messages/actions can fall outside the crop or behind fixed shell edges. All eleven blockers, job progress and actual retry/password interactions are separately asserted. No full-page, native keyboard or password-manager certification is claimed.

Publication uses an ordinary direct push to `main` after the scoped review and related checks. Exact commit, remote-main and committed-blob readbacks and this commit's CI are recorded externally. The preceding login commit's five CI jobs passed; a watcher network interruption is preserved alongside its later verified terminal result.

Evidence: `/Users/majid/.local/state/barghsa-manual-batches/profile-lifecycle-forms/`.
