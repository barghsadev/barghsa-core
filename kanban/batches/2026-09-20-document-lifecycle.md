# Document lifecycle, uploads and review

Branch: `codex/document-lifecycle`, based on PR #318 merge `420a69d6043dd59cf46d08397c64460752bdce84`.

Status: local validation passed; changed-source coverage, independent review and GitHub checks pending.

## Scope

Build the E-05 document backend needed before contract signatures: `05-notifications-documents-ai.md#T-05.11.01`, `.02`, backend review portions of `.04`, replacement/retention portions of `.05` and `.06`, and directly required exact-version links from `04-invoices-wallet-contracts.md#T-04.5.04.01`.

Reuse the existing upload policies, content inspection and provisional cleanup reservations. Separate upload/scan status from business review. Preserve immutable bytes, exact uploader identity, append-only state history and replacement links. Enforce current profile and business permissions on every operation and replay. Customer document reads must preserve the published-contract-version boundary. Signed storage copies must never be represented as customer signature evidence.

## Validation required

- Real migrated PostgreSQL constraints, upgrade and rerun.
- Real HTTP upload, confirmation, submit, approve/reject/request-changes, replacement, removal and download flows against compiled application code and storage integration.
- Permission/profile isolation, hidden contract drafts, step-up/CSRF, revocation races, idempotent retries, stale revisions, transactional audit/notification rollback, immutable copies and competing replacements.
- Relevant upload/contract regression checks, builds/types, lint/formatting, migration snapshot/OpenAPI comparison and actual changed-source coverage gates.
- Independent exact-HEAD approval and all active GitHub checks before merge.

## Remaining criteria

Configured malware-scanner integration, physical deletion retention, document/contract UI, actual signatures and activation remain separate work unless explicitly implemented and verified in this batch. Solar-request association requires its business entity, which is not currently present. Contract amendment/version signing history must be integrated before claiming full signed-document lifecycle coverage. No full epic or task completion is inferred from this backend batch.

The scheduler, historical supervisor state and completion arrays remain unchanged.

## Local evidence

- 111 API tests pass across document, upload, storage, legal-document and contract HTTP integration suites, including real MinIO uploads and downloads.
- Seven production-migrated database tests pass, covering guards, append-only history, retained signed-version locks, schema metadata, upgrade and rerun.
- Nine shared permission tests pass.
- Shared/database builds, API typecheck/build, OpenAPI comparison and migration snapshot checks pass.
- Backlog validation passes for 1,355 tasks and 116 traceability entries; all 322 historical requirement bindings validate.
- API focused coverage is 92.73% lines and 81.40% branches. The committed changed-source gate remains separate.
