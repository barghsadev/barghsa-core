# Exact approval-request handoff

Canonical scope: a direct staff handoff required by the wallet and external refund workspaces under `04-invoices-wallet-contracts.md#T-04.4.01.06`.

Refund details now link to the exact approval request. The approval page validates the request ID, loads that request by ID rather than relying on the current queue filter or page, and provides a return to the queue. The new read endpoint requires financial edit permission and returns only the selected request. English and Persian labels cover the linked view.

Validation: focused approval HTTP integration test, eight Chromium approval-queue tests, API and web typechecks, generated OpenAPI contract and web production checks.
