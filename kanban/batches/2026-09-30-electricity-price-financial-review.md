# Electricity price adjustment financial review

This batch advances `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04` for staff electricity price changes. Staff can request an authoritative priced preview of a future adjustment, including the active profile and contract version, paid invoice basis, service and effective dates, old and new future-period prices, per-component changes, reason and contractual basis.

The bilingual staff dialog presents that snapshot before publishing. The publish command requires its exact hash and recalculates the same values under the profile, contract and invoice locks; changed percentage or price basis rejects the stale confirmation. The confirmed snapshot is recorded in the proposal audit event. Finalization continues to verify the persisted calculation hash against the current paid basis and now displays the stored calculation in the same financial review layout before issuing a charge invoice or credit note.

Focused API integration proves the disclosed calculation equals the persisted proposal, an altered percentage is refused, and charge/credit finalization still works. Shared parsing and staff UI tests cover review structure and displayed values. The wider cross-command review tasks remain partial.

Validation: focused API integration, shared parser and staff UI tests, API/web typechecks and builds, i18n build, OpenAPI contract, lint, formatting, bundle budgets and backlog validation.
