# Saving order next actions

Canonical scope: the next-action requirement in `03-core-business.md#T-03.09.04.03` and the status and payment links in `03-core-business.md#T-03.09.04.04`.

The saving order list and detail now show the same next step from current order, invoice, contract, and cancellation-request facts. Customers can open the invoice for payment review or payment, open the saving order for refund status, and open the published contract when acceptance is due. Staff review, pending cancellation review, fulfillment, and terminal orders show a clear waiting or no-action message. Both screens show the saving order's financial status. The action and status text is available in Persian and English.

The API reads the pending-cancellation flag alongside each authorized order, so the next-action message changes as soon as a request is submitted or resolved. It does not infer the state from a browser-side cache.

Validation: the saving HTTP integration test checks list/detail action facts and pending-request changes; the focused next-action test covers review, acceptance, payment review, payment, cancellation, refund, and completion. Build, typecheck, lint, formatting, OpenAPI, schema snapshot, and backlog checks passed.
