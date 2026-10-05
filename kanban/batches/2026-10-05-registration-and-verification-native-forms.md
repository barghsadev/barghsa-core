# Registration and verification native forms

Date: October 5, 2026. Manual batch under the user's build/review/related-tests/direct-main workflow. No pull request is created.

## Scope and completion boundary

Batch registration destination, password and explicit terms consent with code verification and resend. Reuse `02-auth-users-admin.md#T-01.01.02`, `#T-01.01.03`, `#T-01.01.04`, `#T-01.01.06`, `#T-01.02.02` and `#T-01.02.03`; existing engines are not recounted. Advance global `07-ui-ux-design.md#T-07.10.01.02` through `#T-07.10.01.06` in this family; these parents remain partial.

## Delivered behavior

Two native React Hook Form stages own raw destination, password, explicit consent and code. Deferred active-stage validation links field errors and focuses the first invalid control before I/O. Correcting a destination retains the hidden password draft. The existing normalization algorithm is reused; registration's actual password policy has no maximum and is not narrowed by recovery's separate limit. Complete published terms receipts and locale binding gate consent and submission.

Synchronous ownership precedes validation and public-auth requests. Captured normalized destination, raw password, published terms ID, actual UUID challenge and existing session/resend acknowledgements protect stage transitions and secret cleanup. Verify and resend share ownership; elapsed attempt/resend cooldowns and the registration-specific rejected-code clearing policy remain. Unmount, context, draft generation and physically retired form controls fence late responses and same-frame restart events.

Unknown network/server/malformed-success results hold the draft and offer explicit fresh registration. These unkeyed public actions have no confirmation endpoint, so the UI adds neither blind replay nor a synthetic confirmation read. Restart retains only the raw registration destination, clears secrets and consent, and requires deliberate re-entry. Password/code are not stored or added to URLs; destination hints remain masked. Existing pre-auth CSRF, transactional session/consent/audit, OTP expiry and backend registration deduplication remain unchanged.

## Review and corrections

Root source review verifies both routes, the shared native adapter, deferred schemas, bilingual copy and actual backend wire authority. No independent agent or Codex CLI review is claimed. Native tests expose a same-frame retired consent control; revision fencing plus keyed native forms close it, with an exact regression. Existing error dictionaries, password/OTP components, terms dialog and public-auth transport retain their bytes.

Initial root types reject an optional OTP error value; the call site now supplies null. Two early source commands selected an obsolete native-test filename and ran only the four pure cases; they are not counted as native passes. The first actual native run exposes three checkbox-fixture mistakes: Base UI's visible checkbox differs from its hidden input. Corrected role/ARIA assertions retain consent, error linkage and focus checks. The added retirement regression then exposes and verifies the product fix.

The first 80-case browser run passes 75 and fails five. Four onboarding failures come from the retained fixture returning 404 for the now-required application session check; the fixture supplies the actual session shape. The expiry toast failure comes from lazy Sonner rendering under a paused clock; polling advances scheduled rendering while retaining the visibility assertion. All eight affected locale/browser cases pass on unchanged production assets, without retries. All original failure logs, traces and result bytes are preserved before reruns. The security scanner flags a literal synthetic password in a native fixture; constructing that fixture value removes the finding without suppressions or scanner changes.

## Validation and publication

All 20 distinct selected source/dictionary cases pass: four pure receipt/schema cases, fifteen native cases and one dictionary parity case. After fixture-only repairs, the nineteen web cases pass again. Build (seven tasks), root types (eleven tasks), final web types, scoped lint/format, contracts, suppressed-error checks and all 85 unchanged budgets pass. Strict SAST scans 1,773 files with zero findings/errors and five passing rule fixtures. All 187 protected paths remain byte-identical. Canonical validation passes for 1,355 tasks and 116 traceability entries.

All 80 distinct selected Chromium/mobile Safari cases have zero-retry passing evidence on the same final production assets: eight new native cases plus 72 retained consent, normalization/masking, OTP recovery, cooldown, expiry and onboarding cases. Evidence is the original 75 passes plus all eight affected cases after fixture-only corrections, with three overlapping passes; this is not claimed as one final 80-case run. No selected cases are skipped. Original retained assertions remain, with deliberate fresh registration replacing unsafe automatic replay after unknown results.

Sixteen compact panels are reviewed at original resolution in English light and Persian dark across desktop/mobile: invalid destination, missing consent and uncertain initial/code submission. Focus, readable errors, consent, secret masking, recovery actions and viewport bounds pass within these pictured panels. Full-page layout and native keyboard/password-manager behavior are not certified. All 488 production asset files retain their verified hashes across the selective browser runs.

Final source/assets, root reviews, exact commands, preserved failures and direct-main readbacks are bound externally in `/Users/majid/.local/state/barghsa-manual-batches/registration-and-verification-native-forms/`. The preceding recovery commit `4eb49666bb460781c96755605bda9af6e4e3a913` completed all five GitHub CI jobs successfully: <https://github.com/barghsadev/barghsa-core/actions/runs/37309012014>. This batch's own exact-commit remote CI is reported separately after publication.

## Remaining work

Continue login, password-change and login OTP native stages as the next coherent family. Global form parents remain partial. No backend, migration, financial/auth/session policy, dependency version, CI, generated queue/ledger or historical/external supervisor state changes.
