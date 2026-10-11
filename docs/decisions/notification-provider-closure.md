# Notification provider closure decisions

The owner instructed us on 9 October 2026 to build with the recommended decisions and document the retained designs. This resolves the previously recommended SMS representation choices. The task and release ledger remains `kanban/board.json`.

## SMS configuration and mappings

Retain encrypted transport settings in `sms_provider_configs.config` JSONB, the 15-second default timeout and 100-message-per-minute default quota. Configuration versions keep the existing draft, active, superseded and disabled lifecycle. Activation and rollback require current authority, recent step-up and successful test evidence bound to the saved configuration. Credentials remain masked and encrypted.

Retain locale-aware `template_mappings` inside the configuration. Removing a mapping disables that mapping in the next configuration version. Exact Persian or English mappings take precedence over a legacy shared mapping. Duplicate event/locale identities, duplicate provider parameters and unapproved variables remain invalid. The UI uses the existing variable dropdowns.

Unmapped business notifications can render their published local SMS body for direct-text delivery. This does not remove OTP mappings or weaken the activation proof required for login. A configured mapping never falls back to another physical send after rejection or uncertainty. See [SMS.ir verification templates](../operations/smsir-verification-templates.md) for the owner-deferred live provisioning procedure.

## Credit monitoring

The send response supplies message identifiers and cost, not account balance. Read balance through the separate credit endpoint. Keep six-hour checks, with a successful send advancing the next check at most once per 15 minutes. Failed credit checks retry after 15 minutes. Replica-safe leases and token-bound updates prevent stale observations from overwriting a newer claim.

Low credit still requires the P2 metric and operations alert. A successful API credit read or local rule test does not prove receiver delivery. Record the intended deployed receiver's controlled firing and recovery receipts before accepting that operational gate.

## Delivery identity and uncertain outcomes

On 11 October 2026 the owner explicitly approved occurrence-aware identities and the durable send ledger. A digest of only event, channel and profile would collapse separate orders or payments. New v2 identities include the immutable outbox occurrence, channel and recipient. Existing v1 identities remain stable so an already-attempted message never acquires a new provider key during deployment or retry.

The durable send claim commits before provider I/O. Accepted receipts are recovered without another physical send. A crash, timeout, ambiguous response or lost receipt-write response remains held indefinitely. Neither restarting workers, resetting a retry counter nor waiting past the provider's cache window authorizes another send. A proven rejection permits another attempt only with the same provider, transport and occurrence identity.

[Resend documents a 24-hour idempotency cache](https://resend.com/docs/dashboard/emails/idempotency-keys). Send the stable key in its `Idempotency-Key` header, but preserve the local receipt indefinitely. The [SMS.ir request contracts](https://sms.ir/rest-api/) expose no idempotency-key field. Their physical sends therefore use the committed local claim and acceptance receipt, with uncertainty held rather than retried. This approval does not assert an undocumented vendor guarantee or successful live SMS delivery.

The owner retained the original `auth.otp_sent`, `order.awaiting_staff` and `system.service_outage` event requirements. Each requires its own publisher and acceptance evidence. On 11 October 2026 the owner approved a safe OTP inbox notice containing purpose, delivery time and channel. The OTP itself remains confined to the verified-contact authentication delivery path and must never enter the general inbox or its event payload.

`order.awaiting_staff` is a separate private inbox occurrence when a native electricity, saving, solar or consultation submission enters staff review. Electricity and saving returns to review create a new occurrence; replaying the same command does not. Publication shares the business transaction, so a failure to store the notice rolls back the transition. Existing submission and status events remain.

OTP notices consume confirmed `auth_delivery_outbox` records through a separate transaction. That transaction stores only purpose, channel and delivery time in an account-scoped inbox intent. A notice failure retries this intent without calling the authentication sender again. The recipient is captured from the bound challenge; registration supplies its exact new account only after successful contact verification. The publisher never searches for a later owner of the contact.

Apply migration `0276_auth_delivery_notices` before the updated API and worker. It does not replay historical delivery intents. Secret-bearing active OTP inbox templates become archived versions with retained lineage; their replacements contain delivery metadata only. Authentication email/SMS templates keep their code variables. This migration's versioned template history records the automatic change without inventing a user actor in the account-bound audit ledger. Binary rollback can keep the additive columns and trigger; old workers leave unprocessed notice intents available for the corrected worker.

## Document destruction schedule

The current worker polls hourly and permits document destruction only when the UTC hour is 02. This implements the documented nightly 02:00 UTC window. It is not unrestricted hourly destruction. Each pass remains bounded and requires legal approval, retention eligibility, current hold checks and exact-version deletion. Restarts do not bypass idempotent manifests or permanent financial/contractual retention.

Live versioned-storage cleanup and operations receiver evidence remain separate release criteria. These decisions do not authorize production deployment.
