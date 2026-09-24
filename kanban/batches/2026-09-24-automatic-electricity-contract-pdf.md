# Automatic electricity contract PDF

Canonical scope: `03-core-business.md#T-03.90.01` and the generation step of `04-invoices-wallet-contracts.md#S-04.5.04`.

When a customer submits an electricity order with an admin-selected template, the order transaction creates a PDF from the template text saved on the new contract version. It links the file as that version's original document, records the Uploading, PendingScan, Available and SubmittedForReview transitions, and notifies staff for review. The document identifies the customer as the initiating actor and `system` as uploader type. Staff must still approve it before requesting a signature.

The generated source and immutable copy have independently committed storage reservations. A storage failure rolls back the order; its reservations retain deletion intent for cleanup. Retrying the same order submission succeeds without duplicate contracts or documents. Calling the staff PDF endpoint for an already generated version returns that document instead of making a second copy. Without a configured template, order submission keeps its existing behavior. The staff manual PDF action remains available for manually created electricity contracts and amendments.

Validation: 52 related API integration tests, 39 contract-workspace web tests, root build/typecheck/lint/format, OpenAPI and backlog checks passed. The separate global bundle-budget command still fails on routes outside this batch; the admin contract route passes its budget.
