# Electricity invoice replacement through activation

Canonical scope: `03-core-business.md#T-03.07.01.02`, `03-core-business.md#T-03.07.04.02`, and `04-invoices-wallet-contracts.md#T-04.1.05.02`.

Replacing an unpaid electricity invoice during an unpublished staff review now atomically moves the contract activation reference to the replacement. Customer and staff order views read that reference, so they show the payable invoice and its financial state. Staff approval, customer payment, contract acceptance, and automatic activation then use the same invoice. The original remains cancelled and linked in invoice history. The relink is audited.

A replacement may correct invoice wording or the due date, but must keep the submitted order total and each line's quantity, unit price, and VAT treatment. Financial changes require a contract change. Replacing an electricity adjustment invoice or a published contract's invoice is rejected so those commitments cannot silently diverge.

Validation: migrated HTTP journey covers correction, customer and staff views, approval, payment, acceptance, and activation, plus rejection of changed totals, changed line economics, and published corrections. Related invoice correction suites, database snapshot, OpenAPI contract, build, typecheck, lint, formatting, and backlog checks passed.
