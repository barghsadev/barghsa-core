# Pending amendment status in contract lists

Canonical scope: the list/discovery portion of `07-ui-ux-design.md#T-07.18.03.01` and `04-invoices-wallet-contracts.md#T-04.5.02.04`.

Customer and staff contract lists now show a pending amendment beside the effective contract status. Customer reads expose only published amendments awaiting acceptance or signature; staff can also see internal drafts. The selected contract remains the effective version until the amendment applies. A pending signature keeps the staff next-action guidance visible even when the base contract is Active.

Validation: 27 contract HTTP integration tests, 40 focused web tests, root build/typecheck/lint, OpenAPI, formatting and backlog validation. No schema migration is needed.

