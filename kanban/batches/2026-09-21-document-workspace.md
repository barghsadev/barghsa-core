# Document workspace and staff review

Branch: `codex/documents-ui`. Based on verified PR #319 merge `d6686cb619fb2de180a8f7aa6d02d4fda6f1f434`.

Status: locally validated and committed; awaiting independent review and GitHub checks. No full task completion claims.

## Scope

Deliver the customer Documents page and staff document queue for `05-notifications-documents-ai.md#T-05.11.04` and `.07`, with upload/replacement controls for the merged backend. Reuse existing Persian-first styling, shared controls, password verification and profile context reset. Include list filters/search, document detail/history, safe image/PDF preview, download, customer submission/replacement and reason-required staff decisions.

Preserve exact contract version/role when replacing a document. Do not infer signatures from immutable storage or document approval. No configured scanner, physical retention deletion, contract lifecycle or solar entity implementation is claimed.

## Validation required

Functional UI tests for upload failures/retry, stale review decisions, profile switching, permissions, pagination/filter changes and bilingual/RTL output. Relevant API checks for any query additions. Builds/types, lint, route budget, OpenAPI and changed-source coverage as applicable. Independent exact-HEAD review and all active CI checks before merge.

The scheduler and historical supervisor state remain unchanged.

## Implemented draft

- Customer and staff list/detail routes with state/category/name filtering, pagination, retained history, download and verified image/PDF previews.
- General-document uploads and replacements. Replacement requests preserve the original profile, business record, exact contract version and role. New associated-document uploads remain part of their business detail screens; this page does not ask customers to enter internal record IDs.
- Submit, approve, reject, request changes, quarantine and removal use the current revision and existing password-verification dialog. The API remains authoritative for permissions and signed-document locks.
- Upload retries retain the same file and confirmation key, recover lost successful storage responses, and cancel when the profile context unmounts.
- Server-side literal name search and category filtering preserve existing authorization and pagination.

## Local validation

- 21 frontend tests pass, including both registered routes and navigation, profile-switch isolation, permission failure/retry, filters/pagination, rejection reasons, replacement context, safe previews and interrupted upload/password retries.
- One bilingual dictionary test passes; every label is present in both languages.
- 53 API tests pass: all 34 legacy upload-controller cases and 19 document HTTP cases.
- Four production Chromium tests pass: customer upload/submission and staff password-confirmed review in English and Persian, including keyboard confirmation and RTL.
- Web/API type checks, web/i18n builds, OpenAPI comparison and targeted lint pass. Existing route size budgets pass.
- Focused frontend coverage: 93.10% lines / 87.63% branches. Document API service/validation: 92% lines / 91.25% branches. Dictionary: 100%. The committed changed-source gate is checked separately before review.

Backend PR #319 merged after exact-HEAD approval and all five CI checks passed. This batch is rebased onto that merge and awaits independent review and CI verification. No full canonical task completion is inferred.

The actual changed-source gate passes: frontend 207/235 changed executable lines and 239/273 branches; critical admin/navigation code 7/7 lines; API search/filter branches 6/6; dictionary 3/3 lines and 4/4 branches. No floor was changed.

## PR review and CI follow-up

PR [#320](https://github.com/barghsadev/barghsa-core/pull/320) received independent approval at `7cf85a557a111053f8dcbe4879e0ab964303e682` with no issues. Initial CI detected a translation key named `password` as a literal credential and could not parse the generic dynamic-import type in the navigation mock. Renamed the label key to `verificationTitle` and used the existing Vitest importActual helper without that generic. No scanner rules or exclusions changed. The three affected files scan cleanly, all 21 frontend tests and the dictionary test pass, and web types/format pass. The new commit requires fresh exact-HEAD approval and CI.
