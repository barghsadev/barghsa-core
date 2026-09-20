# Contract review and customer acceptance

Branch: `codex/contract-review-acceptance`, based on PR #316 merge `f27e982e8065081d79bab0ca92669cae6ffd5a21`.

Status: implemented and locally validated; independent review and CI pending.

## Scope

Continue `04-invoices-wallet-contracts.md#T-04.5.01.03` and the customer read portion of `T-04.5.02.02`: submit a draft for staff review, request changes with a reason, revise and resubmit, publish the exact reviewed version, and let the authorized customer accept that exact version.

Customer APIs must expose only published snapshots. They must enforce current active-profile ownership or agent permissions, preserve immutable acceptance evidence, reject stale-version actions and keep state, audit and notifications atomic. Internal drafts must remain private.

## Remaining lifecycle

Signature documents depend on the still-missing E-05 document state machine. Signature, activation prerequisites, amendments, completion/cancellation and automatic refund obligations remain outstanding. This batch must not mark the full lifecycle complete.

## Implementation

Migration 0139 adds immutable publication and acceptance records, bound to the exact contract/version and actual actor. Database triggers apply the corresponding state and acceptance timestamps atomically, reject out-of-order evidence and require evidence before committing customer-visible review states. Existing acceptance timestamps are preserved without inventing publication or customer identities.

Staff can submit a draft, request changes with a reason, revise/resubmit a new material version and publish the reviewed version. Customer APIs list/read only published snapshots and accept an exact current version. Current selected-profile access, agent permissions and session/step-up are rechecked after lock waits. Matching retries are idempotent. Reviewer/customer notices include the contract reference in Persian and English; reviewer notices use account scope so they are visible outside the customer's profile.

Acceptance ends at Accepted. It does not imply a signature, payment or activation.

## Validation

- 41 HTTP integration tests pass against the compiled application and migrated PostgreSQL. Coverage includes the complete review/acceptance cycle, hidden drafts and unpublished revisions, legal/manager/finance permissions, permission removal and profile archival during lock waits, exact-version races, retries, CSRF, step-up, paginated histories/lists above 100 records, immutable evidence and audit/notification rollback.
- 24 database tests pass, including the actual 138-to-139 upgrade and rerun without fabricated legacy publication/acceptance.
- API source coverage: 98.93% lines and 95.45% branches; new schema executable coverage is exercised through typed reads and schema constraint checks. Existing changed/critical gates remain required.
- API/database builds and typechecks, changed-file lint/formatting, snapshot generation guard and OpenAPI comparison pass.
- Independent exact-HEAD approval and all GitHub checks remain required before merge.

## Next

Implement staff/customer contract UI and the document/signature dependency before claiming the full lifecycle complete. The immutable published-version boundary must remain in use for every customer read and acceptance action.

The scheduler and historical supervisor completion arrays remain unchanged.
