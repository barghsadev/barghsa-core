# Notification provider closure decisions

The owner instructed us on 9 October 2026 to build with the recommended decisions and document the retained designs. This resolves the previously recommended SMS representation choices. The task and release ledger remains `kanban/board.json`.

## SMS configuration and mappings

Retain encrypted transport settings in `sms_provider_configs.config` JSONB, the 15-second default timeout and 100-message-per-minute default quota. Configuration versions keep the existing draft, active, superseded and disabled lifecycle. Activation and rollback require current authority, recent step-up and successful test evidence bound to the saved configuration. Credentials remain masked and encrypted.

Retain locale-aware `template_mappings` inside the configuration. Removing a mapping disables that mapping in the next configuration version. Exact Persian or English mappings take precedence over a legacy shared mapping. Duplicate event/locale identities, duplicate provider parameters and unapproved variables remain invalid. The UI uses the existing variable dropdowns.

Unmapped business notifications can render their published local SMS body for direct-text delivery. This does not remove OTP mappings or weaken the activation proof required for login. A configured mapping never falls back to another physical send after rejection or uncertainty. See [SMS.ir verification templates](../operations/smsir-verification-templates.md) for the owner-deferred live provisioning procedure.

## Credit monitoring

The send response supplies message identifiers and cost, not account balance. Read balance through the separate credit endpoint. Keep six-hour checks, with a successful send advancing the next check at most once per 15 minutes. Failed credit checks retry after 15 minutes. Replica-safe leases and token-bound updates prevent stale observations from overwriting a newer claim.

Low credit still requires the P2 metric and operations alert. A successful API credit read or local rule test does not prove receiver delivery. Record the intended deployed receiver's controlled firing and recovery receipts before accepting that operational gate.

## Document destruction schedule

The current worker polls hourly and permits document destruction only when the UTC hour is 02. This implements the documented nightly 02:00 UTC window. It is not unrestricted hourly destruction. Each pass remains bounded and requires legal approval, retention eligibility, current hold checks and exact-version deletion. Restarts do not bypass idempotent manifests or permanent financial/contractual retention.

Live versioned-storage cleanup and operations receiver evidence remain separate release criteria. These decisions do not authorize production deployment.
