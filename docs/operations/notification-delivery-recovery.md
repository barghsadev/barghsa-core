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

History rows count processing attempts. Recovering an accepted receipt or
holding an uncertain receipt does not make another provider request, so those
rows have no measured send duration. The history view explains this distinction.

During graceful shutdown, the worker stops new polls and waits for active
delivery. Once dispatch finishes, it releases any remaining lease it still
owns, including after bookkeeping failure. It cannot release a replacement
worker's lease. A forced process exit leaves its lease to expire; the next
worker recovers accepted receipts or holds uncertain sends. Local tests cover
these paths using the compiled worker, PostgreSQL and a controlled SMS endpoint.

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

## Durable attempt history rollout

Deploy the API and web status readers before enabling migration0128 and the updated worker. Drain every older notification worker first; older senders do not write the new durable history. Migration0128 expands the existing log and snapshots retained receipts without deleting legacy processing rows. It cannot reconstruct attempts already missing before migration. Do not add legacy processing rows and receipt snapshots to infer a physical-send total.

New external attempts commit a unique history token and receipt claim together before provider I/O. Each retry after a proven rejection advances a receipt-owned counter and appends a new row, even if no worker outcome transaction committed. Acceptance/rejection and history updates share one database statement. Bookkeeping and recovered receipts reuse the original row and duration. In-app delivery and preflight failures without a receipt retain transaction-local processing history.

`Sending` means an attempt started but its outcome was not recorded. A dead process may leave this state indefinitely. `Unknown` means the provider result was ambiguous. Neither authorizes another send. If history insertion fails, no request is sent; if its outcome update fails, the durable receipt remains held. Existing provider-reconciliation prerequisites still apply.
