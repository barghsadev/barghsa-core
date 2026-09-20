# Contract signed-copy evidence

Branch: `codex/contract-signature-evidence`. Based on verified PR #321 merge `2aac2f49c37952fa8452f9b2e68715291672f2f5`.

Scope: signature transitions within `04-invoices-wallet-contracts.md#T-04.5.01.03`, and contract-specific document guards in `.04.02`/`.04.04`. Request a signature for the accepted version using an approved original PDF; explicitly record an approved signed copy against the latest request; preserve actor identity and permanently lock the signed version documents. Requests and evidence are immutable and version-bound. Replacing a requested original must permit a new numbered request before signing, without rewriting old requests.

This records reviewed signed-copy evidence; it does not implement cryptographic signing. Automatic template-to-PDF generation, activation prerequisites, amendments/cancellation and refunds remain tracked work. Preparing a request from an approved original is not claimed as automatic PDF generation. No full contract lifecycle task completion is claimed.

Validation pending: production upgrade/rerun, direct database invariants, API authorization/concurrency/replay and exact-document tests, UI/bilingual browser flows, builds/types/lint/format/snapshot/OpenAPI/coverage, independent review and CI.

## Local database progress

Migration 0141 and typed schema add immutable numbered requests and signed-copy evidence. Database guards require the exact accepted version, approved original PDF, latest request and approved signed-role copy. Recording stamps the contract and triggers permanent document retention. Fifteen real migration/document tests pass, including concurrent recording, immutable evidence, wrong-role/profile rejection, retention across later versions and actual 0140 upgrade/rerun without inventing evidence for historical signed flags. Schema snapshot comparison passes. API/UI, broader integration checks, coverage and review remain.

## Implementation and focused validation

Customer/staff signing-evidence APIs require current permissions, fresh verification, exact version/request identity and approved matching documents. Eight real HTTP/MinIO cases cover successful customer/staff recording, wrong roles/profile/version, replaced/quarantined originals, idempotent replay after permission changes and competing recording/replacement transactions. Together with review/document regressions, 44 API tests pass. Fifteen frontend tests and eight production Chromium checks pass in English and Persian. The controls preserve the selected version/request through verification and separate recording identity from upload identity. API/web typechecks, production web/API/i18n builds, targeted lint and OpenAPI update pass. Final committed coverage and independent review/CI remain.

Full main after #320 exposed one admin navigation coverage branch although all functional checks passed. This is tracked for closure without lowering coverage requirements.

## Review correction

Independent review of a8841bb5 requested a historical compatibility correction. Migration 0141 now permits existing signed timestamps on the same historical version to survive normal updates and supported lifecycle transitions, without inventing evidence. New unsigned-to-signed writes still require evidence even when followed by another update in the same transaction. The expanded actual 0140 upgrade/rerun test and all 15 database/document tests pass; eight signature HTTP tests pass again. All critical changed-source coverage groups pass. Static security, secret scan, OpenAPI comparison and 44 route budgets pass. Final corrected-HEAD review and CI remain.
