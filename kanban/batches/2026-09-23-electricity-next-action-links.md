# Electricity order next-action links

Canonical scope: `03-core-business.md#T-03.07.01.04` and `03-core-business.md#T-03.07.04.03`.

The customer order detail now links actionable next steps directly to the invoice payment page, the selected contract, or the correction form. The contract reference on the order detail and the order-submission success screen opens that contract in the contract workspace. Waiting states remain status text.

Review note: replacing an unpaid electricity invoice through the generic invoice correction flow leaves order reads and contract activation tied to the cancelled original. This needs a separate database and contract batch because the current activation requirements deliberately freeze published invoice references.

Validation: focused electricity order-detail UI tests, web typecheck and build, root lint, formatting, contract and backlog checks.
