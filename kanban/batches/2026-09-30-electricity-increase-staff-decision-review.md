# Electricity quantity-increase staff decision review

Canonical work: `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` (staff approval and rejection of customer electricity quantity-increase requests). The broader cross-command review work remains partial.

Staff now previews the exact quantity, current contract and invoice state, policy limit, proposed effective date and decision outcome before approving or rejecting an increase. Approval publishes an immutable amendment for customer signature without creating an invoice; the adjustment amount is calculated later at signature from finalized prices and remaining delivery time. The preview chooses a concrete effective date when staff leaves the field empty. The final command recomputes the review under contract, request and invoice locks, requires its hash, and records the confirmed snapshot in the audit. A stale policy, payment, contract or request state invalidates confirmation.

The bilingual staff dialog displays the reviewed terms and distinguishes approval from rejection. Focused API integration tests cover approval, rejection, stale hash, idempotency and the downstream signature/payment lifecycle; the staff-page test checks that each reviewed hash reaches its corresponding mutation.

Validation: all 38 electricity order integration tests pass; the seven increase lifecycle cases also pass independently after correcting a step-up timestamp fixture race. The policy-change case confirms a stale preview is rejected. Both staff-page tests, API/web builds and typechecks, shared export checks, lint, OpenAPI consistency, all 57 route budgets, formatting and backlog validation pass locally. Remote main CI is pending.
