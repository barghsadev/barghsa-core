# Electricity order status in contract tracking

Canonical scope: `07-ui-ux-design.md#T-07.18.03.01`, the linked-order prerequisite in customer and staff contract lists/details.

For an electricity contract linked to an order, customer and staff contract APIs now include the current electricity order status, scoped to the same profile. Both interfaces show the localized status next to the contract, while retaining the link to the order for its full timeline. Contract, order, and payment states remain separate; solar and saving contracts do not show an electricity status.

Validation: HTTP integration tests cover customer and staff list/detail status, and bilingual web tests cover list/detail labels. Workspace build, typecheck, lint, formatting, OpenAPI, and backlog checks run before push.
