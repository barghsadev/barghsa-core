# Contract drafts and immutable versions

Branch: `codex/contract-drafts`, based on PR #315 merge `7f4cb2c1383c7ef5b46c5c39862f716cddff0616`.

Status: local implementation and validation complete; independent review and CI pending.

## Scope

This batch establishes contract storage, staff draft creation/editing and staff version reads for `04-invoices-wallet-contracts.md#T-04.5.01.01`, `.02`, `.07`, `T-04.5.02.01` and `.02`. It does not mark the entire lifecycle or versioning story complete.

- Migration 0138 adds contracts and immutable full JSONB snapshots. Each contract must commit with its newest version. Version numbers increment exactly once; snapshots, creator, timestamp and change description cannot be rewritten. Acceptance can later be recorded once.
- Staff create drafts and edit only a matching current draft version. Unchanged material JSON does not create a version. Matching retries return the original result, including after later edits; conflicting retry payloads and concurrent stale edits fail.
- Staff version APIs provide a full current snapshot, a bounded metadata history with an exclusive version-number cursor, and individual snapshots bound to the requested contract.
- Writes require current legal contract permission and fresh step-up, lock the profile and actor, reject archived profiles and incompatible/cancelled orders, and commit audit events atomically.
- Existing invoice contract references remain untouched. No synthetic backfill or automatic activation, signature, acceptance or refund effects are introduced.

## Remaining scope

Customer contract detail/version UI and visibility policy, review/submission, acceptance and renewed acceptance, signature, activation prerequisites, amendments, completion/cancellation and automatic refund obligations remain outstanding. The public lifecycle cannot be enabled merely by setting database states. These are the next dependent batches, not completed criteria.

## Validation

- 19 migrated PostgreSQL tests pass, including an actual 137-to-138 upgrade preserving existing profiles and opaque invoice contract references.
- 25 HTTP tests pass against the compiled application and migrated PostgreSQL. They cover concurrent edits/retries, stale-version conflicts, permission revocation during a lock wait, step-up, archive guards, exact string amounts, order identity, history pagination and audit rollback.
- New API source coverage: 100% lines and 94.52% branches. Contract schema coverage: 100% executable lines.
- API/database builds and typechecks, changed-file ESLint, schema snapshot generation guard, generated OpenAPI comparison, backlog and current-requirement validators pass.
- Existing changed/critical coverage floors, independent exact-HEAD approval and all GitHub checks remain required before merge.

No scheduler or supervisor completion history is changed.
