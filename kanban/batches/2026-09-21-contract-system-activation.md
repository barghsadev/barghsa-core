# Next proposed batch: automatic activation

Canonical task 04-invoices-wallet-contracts.md#T-04.5.01.03, activation portion. Depends on PR324. System transitions only Accepted without required signature, or Signed, after exact-version prerequisites are satisfied. End-of-term completion remains separate because the model has no authoritative term-end date; do not infer dates from arbitrary JSON.

Reuse one prerequisite definition for API and worker, ideally a shared DB query/function in packages/db. Avoid duplicating the approval/signature/payment/profile tests. Worker uses existing PollerGroup and job failure recording, bounded batches, resumable scans and safe concurrent runners. Activation must be transactional, idempotent, tied to current version and audited as system action; no staff/customer activate endpoint. Lock evidence so payment refund or profile archival cannot race activation. Existing published requirement snapshots remain immutable.

Database enforcement must prevent entering Active or forging activatedAt without verified prerequisites and exact-version activation evidence. Preserve already-active legacy rows during migration and normal subsequent lifecycle edits. Retain document locks. Tests cover no payment-only activation, optional signature Accepted path, required-signature path, missing/future service-start date, archived profile, foreign/cancelled/refunded invoices, concurrent runners, retries, audit atomicity, invalid state/version and production upgrade. UI already exposes Active through status; real browser flow should confirm state refresh and no manual activation control. Keep completion/cancellation/amendment scope explicit.

Evidence locations: packages/db/drizzle/production/0138_contract_drafts.sql guards identity/terminal state/current version; 0139_contract_review.sql binds publication/acceptance; 0140_document_lifecycle.sql locks documents for Active even unsigned; 0141_contract_signature_evidence.sql permits unchanged legacy signed evidence and retains signature; 0142 snapshots prerequisites. Worker main.ts installs PollerGroup near refund runner. Shared DB exports allow worker reuse without API dependency.

Local batch rebased onto verified PR #324 merge `7c3816394f81ad909818d505f210ebbd53986213`. Its reviewed head331ac8b375fd089879b1a21e43876d65c2701add passed all five checks in run35546506754 and durable review was revalidated after merge.

## Implemented and locally validated

Migration0143 adds immutable exact-version activation evidence and one shared SQL prerequisite resolver. The API delegates to the shared resolver. The worker checks bounded batches every30seconds; insertion rechecks prerequisites under profile/invoice/contract locks, moves the contract to Active and records a system audit atomically. Lock contention and changed prerequisites are retried on later polls. Other database failures reach existing worker failure monitoring. No manual activation endpoint is exposed. Legacy Active records remain unchanged without invented evidence. Legacy Signed records now need actual activation prerequisites before Active.

The contract workspace refresh also reloads its open detail so a system state change becomes visible. Monitoring has Persian/English activation labels and preserves unknown historical job names.

Validation:53 related migrated database cases, including migration from0142 and contention/audit rollback;60 HTTP cases including approved solar signed-copy activation;14 worker/poller cases across two focused runs, including actual compiled worker activation/shutdown;17 frontend cases;6 production browser flows in English/Persian;53 dictionary tests across the full existing suite and new monitoring test;shared job labels;API/worker/db/web typechecks;targeted lint;format;snapshot;44bundle budgets;backlog;static scan886files with0findings. Final committed combined browser/process/unit coverage, independent review and CI remain pending. No source coverage floors or tests were disabled.

Automatic completion at end of term, general editing UI, template PDF generation, amendments/cancellation and automatic refund obligations remain unfinished.

## CI correction

Initial exact-HEAD review approved without findings. CI caught a missing generated OpenAPI enum for the new worker job type. Regeneration adds only `contract_activation` to the existing job filter enum; `pnpm check:contract` now passes. Updated review and CI are pending. Full main after PR #323 passes all five gates.
