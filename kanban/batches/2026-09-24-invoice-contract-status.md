# Invoice and contract status together

Canonical scope: the invoice/contract separation in `04-invoices-wallet-contracts.md#S-04.5.03` and the customer invoice detail flow.

The customer invoice detail response now includes the current state of a linked, published contract through the same profile-scoped lookup that provides its ID. Unpublished or inaccessible contracts expose neither ID nor state. The invoice page shows the localized contract status beside its existing link to the contract, while invoice payment status remains separate. Customers can open the contract to inspect activation prerequisites.

Validation: 27 contract-review HTTP integration tests, 24 invoice-detail web tests, root build and typecheck, edited-file lint and formatting, OpenAPI contract check, and backlog validation passed.
