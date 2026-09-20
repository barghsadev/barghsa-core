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

## Invoice reminder rollout and holds

Drain older reminder senders and notification workers before starting the updated
workers. The sender transfers every planned channel for one invoice/offset into
one outbox occurrence; later channel times become job wake-ups. A schedule row
marked `sent` means transferred to the outbox, not delivered to a provider.

At dispatch, never-attempted reminders recheck current invoice state, deadline,
owner, account, service offset, recipient preferences and local delivery window.
Paid, Cancelled or Refunded invoices and changed deadlines/recipients stop the
queued reminder. Disabled offsets and dirty deadline plans pause without spending
delivery attempts. Re-enabling an offset resumes the same occurrence. Existing
accepted or uncertain receipts are recovered before these policy checks; their
history is preserved and no replacement message is sent.

Each worker database pool needs at least two connections. Reminder dispatches
serialize their policy guards within that pool, holding profile/user/invoice and
policy locks through provider I/O and outcome persistence. Payments and relevant
policy changes can wait for an in-flight delivery to finish. Keep bounded provider
timeouts and the existing graceful drain procedure.

Old senders could transfer in-app first and omit later email/SMS jobs. If an
existing occurrence has missing jobs or a different recipient/deadline, the new
sender reports `Existing reminder occurrence requires reconciliation` and leaves
the remaining schedule rows intact. Review its schedule rows, outbox payload,
channel jobs, receipts and send history together. Do not mark missing channels
delivered, replace the occurrence key, delete history or resend without
authoritative provider evidence and an audited recovery action. Repeated holds
can occupy the oldest-due batch; resolve them operationally before enabling the
schedule. No historical data reconciliation was executed by the local audit.

SMS mappings may select Persian or English for the same event; an exact language
mapping takes precedence over an existing All languages mapping. With no exact
or shared mapping, delivery fails closed. Upgrade API, web and every SMS worker
together before saving language-specific mappings. Test every configured mapping
to the authorized staff recipient before activation. Existing mappings remain
shared, and attempted-message snapshots retain their original template IDs.
Local tests verify payloads and template selection with controlled providers;
they do not verify live SMS.ir template text or delivery.

## Reconciliation

### Top-up expiry notices

Replace all older expiry workers before the next scheduled expiry scan. Updated
workers enqueue `payment.wallet_topup_failed` in-app/email jobs in the same
transaction as the TTL rejection and audit record. The notice uses the existing
wallet template and a Persian/English expiry explanation. Publish the required
templates using the template-seeding runbook before enabling external dispatch.

The expiry occurrence key includes the original top-up ID; a repeated scan does
not create another notice. A missing customer owner or failed outbox write leaves
the intent Pending and reports a failed scan for investigation. Its wallet balance
never changes. The profile lock binds the queued notice to the current owner;
delivery still applies current recipient availability and preferences.

Gateway authority remains available for a later verified callback. Expiry means
the confirmation deadline passed, not proof that no money was deducted. The
notice asks the customer to check their wallet before retrying. Previously expired
rows are not backfilled or resent automatically. No production rollout or live
delivery has been executed by the local audit.

### Uncertain provider outcomes

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

## Resend callback attribution

Apply migration0129 before deploying the callback receiver and delivery-history API together. Drain older API instances receiving callbacks; their handler can overwrite aggregate job state and append false send attempts. Notification workers need no change for this migration. No rollout has been executed by the audit.

New callbacks retain the IDs of every active or superseded Resend configuration whose endpoint secret verifies the signature. Disabled configurations are not accepted. Keep superseded endpoint secrets while their accepted messages can still receive feedback. The receiver decrypts only the webhook secret, not the send API key. Recipient arrays and nested bounce details follow the [Resend payload contract](https://resend.com/docs/webhooks/emails/bounced); rotated candidates follow the [Svix space-separated signature contract](https://docs.svix.com/receiving/verifying-payloads/how).

Callbacks do not change worker leases, outbox/job state, accepted receipts or physical send rows. The admin history combines each accepted Resend email attempt with its verified callback feedback using provider ID, message reference and attempt token. A bounce appears as Failed on the original attempt, with its original duration and number. A later delivered callback cannot erase that bounce or authorize another send. Early callbacks remain available when receipt persistence finishes.

Legacy callbacks have an empty verified-provider list. Their original payloads and suppression records remain, but their provider identity is not guessed. Old synthetic attempt rows also remain historical evidence; this repair cannot reconstruct missing sends or safely delete ambiguous history.

## Complaint correction queue

Apply migration0131 before the updated callback/admin API and web. Drain older callback API instances before migrating so complaints cannot bypass task creation. The migration backfills existing complaint suppressions into one open correction per address. New complaints create the suppression and correction in the same transaction. Profile deletion retains both records with a null profile reference.

Staff with `admin:jobs:view` can open Customer contact corrections on the failed-notifications or notification administration page. Completing a correction requires `admin:jobs:retry`, a current session with step-up verification, and a resolution note. Completion is audited and stays in the completed list. It does not remove email suppression, send a message, or claim the recipient consented. A later complaint can open a new correction. No production migration or customer follow-up has been executed by this audit.
