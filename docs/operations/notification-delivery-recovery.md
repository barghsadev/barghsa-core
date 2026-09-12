# External notification recovery

Email and SMS workers record send ownership in `notification_send_receipts`
before calling the provider. This record commits independently of inbox and
queue bookkeeping. It is keyed by the durable outbox occurrence and channel.

| Receipt state | Worker behavior                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| No record     | Run current recipient/provider checks, claim the send, then contact the provider.                              |
| `sending`     | A worker may still be sending, or it may have stopped. Hold for reconciliation.                                |
| `accepted`    | Reuse the stored provider receipt and finish bookkeeping without sending again.                                |
| `rejected`    | A provider explicitly rejected the request. A bounded retry may use the same provider and occurrence identity. |
| `unknown`     | The response or acceptance record is uncertain. Hold for reconciliation.                                       |

A timeout, disconnected socket, ambiguous HTTP error, malformed success, or
missing provider receipt does not prove that nothing was sent. These outcomes
go to the dead-letter queue immediately. Staff Retry returns a conflict for
`sending` and `unknown` receipts. Resolve and Dismiss acknowledge the queue
entry; neither sends a message nor changes the send evidence. Resetting job
attempts or allowing its lease to expire does not clear this protection.

An accepted receipt survives failure of the transaction that records inbox,
job, log and aggregate outcomes. Recovery checks it before current recipient
preferences. This records a previous acceptance even if contact details or
consent changed; it does not authorize a new send to the previous destination.

## Rollout

1. Stop dispatch and drain **all older notification workers** before migration
   `0127_notification_send_receipts`. A mixed fleet is unsafe: older workers do
   not consult send ownership.
2. Apply the migration before starting updated workers or the updated staff API.
   The migration preserves unfinished historical attempts as `unknown` when
   their queue, log or dead-letter history indicates a possible send. It does
   not delete their jobs, snapshots or history. Never-attempted jobs remain
   eligible for normal delivery.
3. Start updated workers and API together. Check held jobs and open-failure
   alerts using the monitoring runbook. Verify this sequence in the target
   environment before enabling scheduled dispatch.

No production rollout or provider delivery has been verified by the local tests.

## Reconciliation

Keep the outbox ID, channel, provider identity, occurrence key, attempt token,
safe error, timestamps and any receipt with the incident. Establish that no
older worker remains in flight. Obtain authoritative provider evidence for
acceptance or non-acceptance before considering another delivery.

Do not delete receipt records, reset their state, replace an occurrence key, or
create a replacement notification to bypass a hold. The application does not
yet offer an audited provider-reconciliation action. Until that action and the
provider evidence contract are implemented, unresolved sends remain held;
staff may acknowledge them without resending.

SMTP Message-ID is not proof of provider deduplication. Resend receives the
occurrence idempotency key, but this worker does not assume an unlimited replay
window. The current SMS.ir request has no idempotency-key field. The durable
guard prevents a second application send after uncertainty; it cannot prove
provider-side exactly-once delivery or eventual delivery.

Authentication delivery and provider self-tests use separate workflows. This
notification receipt table does not certify their crash recovery.
