# Refund backlog

**Incident P1 for materially delayed refunds, with P0 escalation for suspected duplicate movement. Finance owns settlement and operations owns queue recovery.** The symptoms include overdue open obligations, repeated failed jobs or payment-provider inquiries that remain unresolved.

1. Identify the specific obligation, contract or original order, refund method and existing ledger or provider receipt in the authorized Finance workspace. Record each affected amount in protected evidence. Compare queue eligibility and worker readiness before requesting an attempt.
2. Read failures in `/admin/failed-jobs` and inspect the related source obligation. Investigate an uncertain external outcome with the payment provider. Preserve mandatory refund obligations and previously accepted credits. Keep the obligation open when the result cannot be confirmed.
3. Correct the cause, then request one permitted retry with current capability and step-up through the existing refund or failed-job workflow. Observe the same obligation and execution identity. A requeued job is pending until settlement is verified. Resolve administrative tracking only after Finance has reconciled the outcome.
4. Confirm a single full settlement where required, the source payment and obligation match, the refund ledger is consistent and the backlog decreases without new unexplained failures. Check that the case can close through its normal safeguards.

Call the Finance lead and primary if the provider cannot prove the outcome or a second transfer is possible. Preserve receipts and retry history and track recurrence in the incident follow-up. [Incident response](../operations/incident-response.md).
