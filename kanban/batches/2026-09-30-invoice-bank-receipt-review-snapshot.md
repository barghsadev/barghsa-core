# Invoice bank-receipt financial review

This batch advances `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04` for staff confirmation of a bank receipt tied to an invoice. The broader cross-command review tasks remain partial.

Finance staff now receive an authoritative confirmation snapshot with the receipt evidence, current invoice and profile, remaining balance, exact invoice allocation and wallet excess, wallet balance, and the current two-person approval rule. The bilingual confirmation view uses the shared financial summary. The HTTP confirmation requires its exact hash; the service re-reads the snapshot under the profile, threshold, receipt, approval, wallet and invoice locks before parking for approval or settling. Changes to the invoice, receipt or approval rule reject stale confirmation. The confirmed snapshot is retained in the corresponding approval-requested or receipt-confirmed audit event. A retry of an already parked receipt by the same initiator remains safe and does not create another approval request.

The batch also updates five older CI integration cases to follow the financial review endpoints introduced in the previous refund and invoice-correction batches. Their expected business outcomes remain covered.

Validation: focused invoice bank-receipt settlement and dual-approval integration, controller and staff UI tests, the dual-approval HTTP suite, the five repaired CI cases, shared/API/web builds and typechecks, contract, lint, formatting, bundle budgets and backlog checks. Remote CI is pending until this batch is pushed.
