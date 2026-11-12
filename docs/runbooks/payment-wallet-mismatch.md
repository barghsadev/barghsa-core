# Payment or wallet mismatch

## Working-hours review (P3)

`WalletReconciliationReview` reaches the private operations inbox when a database has open or investigating reconciliation mismatches and its reported critical wallet drift is zero. Finance reviews the affected records in `/admin/reconciliation` during working hours, preserves the supporting evidence, and records the disposition in the existing audited workflow. Check the independent reconciliation panel for current state. If the review finds possible duplicate movement or a payment or balance that cannot be explained, use the incident procedure below immediately.

## Payment or ledger incident

**Incident P0. Finance leads reconciliation and platform operations handles containment.** Suspected duplicate charges, a payment that disagrees with its invoice, or an unexplained wallet-to-ledger discrepancy can affect available balances and the ability to settle an invoice.

1. Open a P0 incident and record the affected profiles, financial references, correlation IDs and first known discrepancy in protected evidence. Suspend the affected payment initiation path under the approved production control. Preserve provider callback and inquiry evidence.
2. Read the affected rows through `/admin/reconciliation` and compare the linked invoice, payment intent and immutable wallet ledger. For an external payment, compare the provider transaction receipt and use provider inquiry to resolve an unknown result before retry. If the vendor and internal records differ, preserve both records and hold further action pending Finance review.
3. Use the existing audited Finance workflow with current permissions and step-up for any authorized correction. Keep the original ledger, payment and idempotency records. A database edit or a fresh payment request cannot resolve an uncertain provider result.
4. Verify the provider receipt and internal settlement agree, the derived wallet balance equals the ledger and the invoice state matches its accepted payments. Confirm scoped customer readback and monitor the next reconciliation scan before lifting containment. A ready API alone does not establish financial correctness.

The private Payments, Wallet and Refunds dashboard shows one-hour snapshots of recorded outcomes and refunds. It uses the latest observed outcome per payment intent and the durable amount of each audited, completed refund. Wallet invoice payments have a completion count. The success share applies to online top-ups and bank receipt decisions, whose records include unsuccessful outcomes. Compare the activity collection panel with the independent reconciliation and alert signals. Use the protected ledgers to reconcile exact balances and investigate individual cases. [Finance dashboard](../../deploy/monitoring/grafana-finance-safety-dashboard.json).

Call the primary and Finance lead immediately if any second movement is possible or a discrepancy remains. Retain the evidence and audit references and assign the defect and recurrence check in the incident follow-up. [Incident response](../operations/incident-response.md). [Invoice origin and settlement](invoice-origins.md).
