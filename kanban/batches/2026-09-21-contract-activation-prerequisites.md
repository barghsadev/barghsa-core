# Contract activation prerequisites

Local draft on `codex/contract-activation-prerequisites`, following merged signature PR #322 and route follow-up #323. Base is verified #323 merge `fee178e7ae6637645d3d742ec414f4e0231ee7a0`.

Canonical batch: `04-invoices-wallet-contracts.md#T-04.5.01.04`, `#T-04.5.03.01`, `.02` and `.03`. Configure requirements per service type, preserve a snapshot per immutable contract version, resolve staff publication/customer acceptance/signature/payment/service-start evidence, and display unmet requirements in customer/staff contract details. Admin edits must be audited, permission checked and version guarded. Solar signatures and electricity initial payment cannot be disabled. Contract and payment status remain separate.

Implementation starts with typed rules and version requirements. Electricity defaults to initial payment required and optional signature; savings skips signature/payment; solar requires signature. Staff publication and customer acceptance remain mandatory through the existing workflow. Requirements snapshot at version creation; later settings edits affect new versions only. Initial invoice and service-start context can be set only before publication; accepted versions cannot silently change them. Exact invoice lineage/profile/order ownership must be checked. Missing evidence stays unmet.

Automatic Active/Completed transitions, template-to-PDF generation, contract editing UI, amendments/cancellation and automatic refund obligations remain separate unfinished criteria. This batch must not claim them complete. Implementation and local validation are recorded below. Review and CI remain pending.

## Local foundation validation

Migration 0142 adds typed rules and per-version snapshots, defaults/backfill, immutable rule fields, guarded draft invoice/date context and publication locks. Exact invoice ownership is checked. New versions retain valid invoice/date context and capture current rules. Material-change validation now compares terms plus activation requirements after the transaction is complete. Existing contracts remain protected against duplicate versions. API create/update accept explicit invoice/date context; a context-only change creates a new version.

43 related migrated database cases pass, including production upgrade/rerun and previous signature/document guards. The 29 contract HTTP cases pass with new context-only versioning, replay, foreign/missing invoice rejection and timezone validation. API typecheck passes. Earlier 51 related contract/review/signature HTTP regressions passed before the final deferred material-change adjustment; rerun the relevant set before this batch is finalized. Rule administration, resolver, UI, final OpenAPI/coverage, review and CI remain to build or verify.

## Backend progress

Rule read/update APIs now enforce current staff permissions, revision checks, step-up, idempotent replay and atomic audit. The resolver reads the exact authorized version and its captured rules, publication, acceptance, signature evidence, matching paid invoice and server-evaluated start date. It never changes contract state. Customer reads keep profile/publication boundaries; archived profiles cannot become ready. Refunds make required payment unmet. Solar requires actual recorded signature evidence. Admin edits do not alter prior version requirements.

All 60 related HTTP integration cases pass across contract drafts, review, signatures and activation; all 43 related database cases pass. API typecheck and targeted lint pass. UI controls, bilingual browser flows, final coverage/static checks, independent review and CI remain. The earlier pre-adjustment regression note is superseded by these results.

## Interface and focused validation

Customer and staff details now show exact-version prerequisites, missing invoice context, start time and readiness without changing state. Staff can view rules and permitted catalogue administrators can edit optional requirements through the existing password-confirmation flow. Mandatory solar signature and electricity payment stay locked. English/Persian labels are complete. Existing contract editing UI remains deferred; draft context is available through the validated API.

43 database, 60 HTTP integration, 22 frontend and 12 production Chromium cases pass. Browser flows cover both languages, rule revision/idempotency through password verification and payment readiness separate from Accepted state. API/web types, targeted lint, formatting, migration snapshot and backlog validation pass. Local process/unit coverage meets the unchanged source thresholds. Final committed browser coverage, independent review and all five CI gates remain pending.
