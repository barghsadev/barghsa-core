# Contract versions and linked documents

Branch: `codex/contract-workspace`. Based on verified document UI PR #320 merge `cefe44c42df68473bb5bb3488e053987cac78823`.

Status: implementation and focused local validation complete; changed-source gate passes; independent review and CI required before merge.

## Scope

`04-invoices-wallet-contracts.md#T-04.5.02.03` and `#T-04.5.04.05`, with customer exact-version acceptance and contextual document uploads using existing APIs. Staff listing is directly required scaffolding. Customer reads show published versions only. Profile changes abandon pending reads. Linked documents are filtered by the selected exact version on the server. Uploads derive profile, contract, version and role from the selected authorized contract.

Customer and staff routes have navigation links, list/detail views, version history, terms rendered as escaped text, and existing password-confirmed actions. Customer acceptance requires an explicit acknowledgement. Historical versions have no acceptance/upload actions. Staff can submit a draft, request changes with a reason, or publish its exact version. Signed copies use the document lifecycle and do not imply a signature or activation.

The full stored snapshot is displayed without coercing decimal strings to numbers or inventing financial units. Deep imported structures have a text fallback. Staff history identifies its recorded creator; customer history preserves the existing API privacy boundary.

New draft creation/editing, typed financial preview, activation, signatures, amendments, cancellation and automatic refunds remain separate work. Generic snapshots do not provide those features. No full epic completion is claimed.

## Validation

- 62 API integration tests pass across contract drafts/listing, publication/acceptance and documents. New cases verify bounded staff pagination, filters, authorization, invalid queries and exact-version document lists.
- 21 frontend tests pass across contract/document workflows and both route/navigation tests. Contract cases cover bilingual output, exact-version acceptance, profile-switch stale responses, list pagination/filter errors, staff review reasons, historical/signed restrictions, contextual uploads and safe snapshot rendering.
- Four production Chromium tests pass: customer acceptance followed by contextual signed-copy upload, and staff publication, in English and Persian. Password verification retries retain the exact version and idempotency key.
- Dictionary parity and coverage pass. Web/API types, web/i18n/API builds, targeted lint/format, OpenAPI comparison, static scanning and route budgets pass.
- Focused coverage: frontend 94.34% lines / 89.47% branches; changed contract API files 99.07% lines / 93.40% branches; document service/validation 92% lines / 91.44% branches. Actual committed changed-source coverage is verified separately.
- Canonical backlog validates 1,355 tasks and 116 traceability entries. Scheduler and historical supervisor state remain unchanged.

One local frontend coverage attempt collided with the API fixture rebuilding a shared package; the sequential rerun passed. No source or policy exclusion was introduced.

Actual committed coverage gate passes against the verified #320 merge: critical API 107/108 lines and 85/91 branches; critical frontend 164/168 lines and 150/161 branches; document filter changes 4/4 API branches; remaining frontend 6/6 lines and 16/16 branches; dictionary 3/3 lines and 4/4 branches. Floors remain unchanged.

## PR and CI follow-up

PR [#321](https://github.com/barghsadev/barghsa-core/pull/321) was independently approved at `e40f2f591fc8a63be5b9a42ba60c0730fefbffa2`. CI found formatting differences in two method chains. The correction changes whitespace only, and the repository-wide format check now passes. API coverage is refreshed for the shifted source lines; a new exact-HEAD review and CI run are required.
