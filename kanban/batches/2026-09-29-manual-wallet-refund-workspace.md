# Manual wallet refund workspace

Canonical scope: the staff-facing wallet portion of `04-invoices-wallet-contracts.md#S-04.4.01` and `04-invoices-wallet-contracts.md#T-04.CC.07.03`. External-bank refunds and the cross-command financial review task remain open.

Finance staff can now open an invoice from the ledger or by ID, see its paid, refunded, reserved and available balances, and resume earlier wallet refund requests. The workspace supports request, approval, rejection, cancellation and processing with a financial confirmation summary. Existing server-side balance, step-up, dual-approval and idempotency checks remain authoritative. The new read endpoint is permission-scoped and paginated.

The neighboring invoice deadline browser fixture now supplies the staff session and selected locale required by the current admin route, keeping its four regression scenarios usable.

Validation: wallet refund HTTP integration tests; English and Persian Chromium request-to-completion journeys; four invoice-deadline Chromium scenarios; API and web typechecks; changed-file lint and formatting; OpenAPI contract check; web production build and route budgets; canonical backlog validation.
