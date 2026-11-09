# Payment or wallet mismatch

**Incident P0. Finance leads reconciliation and platform operations handles containment.** Suspected duplicate charges, a payment that disagrees with its invoice, or an unexplained wallet-to-ledger discrepancy can affect available balances and the ability to settle an invoice.

1. Open a P0 incident and record the affected profiles, financial references, correlation IDs and first known discrepancy in protected evidence. Suspend the affected payment initiation path under the approved production control. Preserve provider callback and inquiry evidence.
2. Read the affected rows through `/admin/reconciliation` and compare the linked invoice, payment intent and immutable wallet ledger. For an external payment, compare the provider transaction receipt and use provider inquiry to resolve an unknown result before retry. If the vendor and internal records differ, preserve both records and hold further action pending Finance review.
3. Use the existing audited Finance workflow with current permissions and step-up for any authorized correction. Keep the original ledger, payment and idempotency records. A database edit or a fresh payment request cannot resolve an uncertain provider result.
4. Verify the provider receipt and internal settlement agree, the derived wallet balance equals the ledger and the invoice state matches its accepted payments. Confirm scoped customer readback and monitor the next reconciliation scan before lifting containment. A ready API alone does not establish financial correctness.

Call the primary and Finance lead immediately if any second movement is possible or a discrepancy remains. Retain the evidence and audit references and assign the defect and recurrence check in the incident follow-up. [Incident response](../operations/incident-response.md). [Invoice origin and settlement](invoice-origins.md).
