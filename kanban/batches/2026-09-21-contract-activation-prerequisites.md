# Contract activation prerequisites

Local draft on `codex/contract-activation-prerequisites`, following signature PR #322 and the validated route-loading follow-up. Rebase onto their verified merges before opening this batch PR.

Canonical batch: `04-invoices-wallet-contracts.md#T-04.5.01.04`, `#T-04.5.03.01`, `.02` and `.03`. Configure requirements per service type, preserve a snapshot per immutable contract version, resolve staff publication/customer acceptance/signature/payment/service-start evidence, and display unmet requirements in customer/staff contract details. Admin edits must be audited, permission checked and version guarded. Solar signatures and electricity initial payment cannot be disabled. Contract and payment status remain separate.

Implementation starts with typed rules and version requirements. Electricity defaults to initial payment required and optional signature; savings skips signature/payment; solar requires signature. Staff publication and customer acceptance remain mandatory through the existing workflow. Requirements snapshot at version creation; later settings edits affect new versions only. Initial invoice and service-start context can be set only before publication; accepted versions cannot silently change them. Exact invoice lineage/profile/order ownership must be checked. Missing evidence stays unmet.

Automatic Active/Completed transitions, template-to-PDF generation, contract editing UI, amendments/cancellation and automatic refund obligations remain separate unfinished criteria. This batch must not claim them complete. All validation, API/UI implementation, review and CI remain pending.

## Local foundation validation

Migration 0142 adds typed rules and per-version snapshots, defaults/backfill, immutable rule fields, guarded draft invoice/date context and publication locks. Exact invoice ownership is checked. New versions retain valid invoice/date context and capture current rules. Material-change validation now compares terms plus activation requirements after the transaction is complete. Existing contracts remain protected against duplicate versions. API create/update accept explicit invoice/date context; a context-only change creates a new version.

43 related migrated database cases pass, including production upgrade/rerun and previous signature/document guards. The 29 contract HTTP cases pass with new context-only versioning, replay, foreign/missing invoice rejection and timezone validation. API typecheck passes. Earlier 51 related contract/review/signature HTTP regressions passed before the final deferred material-change adjustment; rerun the relevant set before this batch is finalized. Rule administration, resolver, UI, final OpenAPI/coverage, review and CI remain to build or verify.
