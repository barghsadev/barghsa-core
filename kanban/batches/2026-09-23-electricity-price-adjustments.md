# Staff electricity price adjustments

Canonical scope: `03-core-business.md#T-03.08.02.01` through `.04` and the overlapping `04-invoices-wallet-contracts.md#T-04.6.02.01` through `.06`.

Authorized staff publish a price proposal for an active electricity contract with a future effective date, signed percentage change, reason and contractual basis. A persisted calculation prices only the eligible future portion of each paid electricity component. The customer sees the proposal, old and new future-period values and component calculation before staff can finalize it. Finalization revalidates the unchanged basis, requires both contract and invoice permissions plus step-up authentication, and issues a linked charge invoice or credit note. The paid original invoice and its historical lines remain unchanged. Cancellation of an open proposal issues no invoice. Each state transition is audited and notifies the customer.

The calculation includes an effective, paid quantity increase and earlier finalized price adjustments. A still-open quantity request or price proposal blocks a competing change. A later customer quantity increase includes the finalized price adjustments in its quote. Unpaid charge adjustments use the normal invoice due and overdue lifecycle.

Validation passed: the migrated electricity API suite (3 files, 40 tests) covers charge and credit proposals, disclosure before finalization, permission and stale-review gates, linked invoice or credit, cancellation, and quantity-increase pricing in both orders. The focused web suite passed (4 tests), as did i18n tests (53), API and web typechecks, API and web builds, database snapshot and OpenAPI contract checks, changed-file ESLint, and backlog validation.
