# Paid consultation closure batch

Canonical scope: the paid cancellation and rejection paths of `03-core-business.md#T-03.03.01.02`, `03-core-business.md#T-03.03.03.05`, and `03-core-business.md#T-03.03.03.06`.

Financially authorized staff with a fresh step-up can cancel or reject a paid consultation. In one transaction, the service cancels an outstanding unpaid revised charge, issues credit notes for the remaining paid balance, requests wallet refunds, records the consultation decision and audit history, and notifies the customer. Existing reserved refunds are subtracted, so a later closure cannot request the same money twice. A repeated key returns the same result; a changed reason or action conflicts. The customer detail shows each refund state and explains that closing the consultation does not mean the refund has finished.

Partially funded invoices and rejected or cancelled earlier refunds still require a separate finance resolution before a further paid consultation change. The normal unpaid cancellation route continues to reject consultations with any paid invoice.

Validation: HTTP integration covers an accepted paid request, a paid fee increase with an unpaid charge, cancellation of that charge plus a full refund request, replay and conflicting replay, and rejection after a prior partial refund reservation. The focused consultation suites pass 7/7 tests. Root build, typecheck, lint, formatting, backlog, and OpenAPI checks pass.
