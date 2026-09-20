# Document lifecycle, uploads and review

Branch: `codex/document-lifecycle`, based on PR #318 merge `420a69d6043dd59cf46d08397c64460752bdce84`.

Status: local validation and changed-source coverage passed. PR #319 awaits independent review and GitHub checks.

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
- Ten production-migrated database tests pass, covering guards, append-only history, retained signed-version locks, schema metadata, upgrade and rerun.
- Nine shared permission tests pass.
- Shared/database builds, API typecheck/build, OpenAPI comparison and migration snapshot checks pass.
- Backlog validation passes for 1,355 tasks and 116 traceability entries; all 322 historical requirement bindings validate.
- API focused coverage is 92.73% lines and 81.40% branches. The committed changed-source gate passes: API 472/511 lines and 399/480 branches; critical contract helper 23/23 lines and 3/3 branches; changed database schema and critical permission lines all covered.

## Reproduction commands

All commands run from the repository root unless using a package filter.

```sh
pnpm --filter @barghsa/api exec vitest run src/documents/document-http.integration.test.ts src/upload src/admin/upload-policy-http.integration.test.ts src/storage/storage-access-http.integration.test.ts src/profiles/legal-documents-http.integration.test.ts src/contract/contract-http.integration.test.ts src/contract/contract-review-http.integration.test.ts --coverage --coverage.include="src/documents/*.ts" --coverage.include="src/upload/upload.service.ts" --coverage.include="src/upload/upload.controller.ts" --coverage.include="src/upload/upload-access.ts" --coverage.include="src/upload/upload.module.ts" --coverage.include="src/database/idempotency.ts" --coverage.include="src/contract/contract-transactions.ts" --coverage.include="src/app.module.ts"
pnpm --filter @barghsa/db exec vitest run src/documents.migrated.test.ts --coverage --coverage.include="src/schema/documents.ts" --coverage.include="src/index.ts"
pnpm --filter @barghsa/shared exec vitest run src/agent-permissions/agent-permissions.test.ts --coverage --coverage.include="src/agent-permissions/index.ts"
python3 scripts/check-changed-coverage.py --base 420a69d6043dd59cf46d08397c64460752bdce84 --report /tmp/barghsa-document-coverage-gate.json
pnpm --filter @barghsa/shared build
pnpm --filter @barghsa/db build
pnpm --filter @barghsa/api typecheck
pnpm contract:update
pnpm check:contract
pnpm check:db-snapshot
python3 kanban/scripts/build_backlog.py --check
python3 audit/current_requirements.py
```

All commands above pass. Targeted ESLint and Prettier checks also pass.

## Review correction

Initial exact-HEAD review found cross-version/cross-role contract replacement lineage was insufficiently guarded. The API now requires the same version and role; a deferred database constraint checks both immutable links at commit. Database regression tests reproduced both invalid commits before the fix, then passed both rejection cases and a valid matching replacement. HTTP tests cover staff and customer mismatches. All 111 API and ten database tests pass after the correction; types and lint pass. Final exact-HEAD review remains pending.

## CI fixture correction

Run 35538262905 passed all 851 database assertions but failed on an unhandled PostgreSQL 57P01 shutdown error in the independent PostgreSQL 17 metrics fixture. The installed pool implementation removes clients before their disconnect callbacks finish, so awaiting pool.end alone can stop the container too early. The fixture now registers end promises on connected clients and awaits them before stopping PostgreSQL. All 17 metrics tests, targeted lint and formatting pass. No production behavior, test assertions or coverage thresholds changed.

The next CI run, 35538659062, passed all 851 database tests and 460 worker tests, but the API suite found 34 legacy upload-controller tests whose isolated Nest fixture did not provide the extracted UploadService. Its other 5,258 API tests passed. The fixture now registers the real service alongside the existing storage/policy stubs; all 34 legacy tests and 18 document HTTP tests pass locally. No production behavior or assertion was changed.
