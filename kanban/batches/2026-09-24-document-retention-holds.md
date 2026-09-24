# Document retention policy and legal hold batch

Tasks: `05-notifications-documents-ai.md#T-05.14.01` and
`05-notifications-documents-ai.md#T-05.14.02` (P1).

The database seeds versioned retention policies: ten years for contracts,
invoices, payments, refunds and signed documents, and five years for other
uploads. Legal staff can append policy versions with an approval note. They
can also create, view and release document or profile-wide legal holds. The
admin document workspace exposes both controls, with step-up verification,
bilingual copy, and audit records. The `document_is_held` database predicate
combines active holds and policy-wide holds for the destruction workflow.

Validation: document HTTP integration and document workspace component suites,
root build, typecheck, lint and formatting, OpenAPI contract, migration snapshot
and backlog checks. The operational limits are in
`docs/operations/storage-retention.md`.

T-05.14.03 remains: retention expiry from parent closure, approved nightly
destruction, physical object deletion and per-item audit. Until then, the new
policy and hold data do not trigger object deletion.
