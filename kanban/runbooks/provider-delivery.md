# Email and SMS provider operations

Scope: SMTP, Resend, and SMS.ir delivery configured at **Admin → Providers**. This runbook reflects the application's current transport behavior. Check the provider account's own contract for external quotas; those limits are not fixed by this repository.

## First response

1. Open **Admin → Providers**. Note the active provider, circuit state, last failure, one-hour failure rate and latency, queue depth, and recent alerts. Record the provider ID and affected channel in the incident log. Do not copy secrets or raw provider responses into tickets.
2. Check **Admin → Failed notifications** for permanent failures and dead letters. An `unknown` delivery outcome may have reached the provider; reconcile its provider receipt before another send. Do not manually reset the receipt or replay that attempt on assumption.
3. If authentication or payment notifications are affected, page the on-call operations owner immediately. Escalate a sustained outage or growing queue to the incident commander and the provider's support channel for the account. Use the account's approved support contacts; no contact address is stored here.
4. Prepare a replacement provider configuration as a draft. A successful test send to the staff member's verified contact is required before activation. Preserve the previous version for rollback. A draft test does not reset an active provider's circuit; one leased live send probes recovery after cooldown.

## Common retry and breaker rules

- Five transient failures within five minutes open a provider's circuit. It refuses sends for one minute, then allows one recovery probe. A successful probe closes it; a failed probe starts another cooldown. Email and SMS use the same durable state machine per provider.
- The worker's standard retry delays are 1 minute, 5 minutes, 30 minutes, and 2 hours with ±20% jitter; the default budget is five attempts. Authentication OTP has a three-attempt budget. Exhausted or permanent failures go to dead letter. An uncertain external outcome is held for reconciliation rather than blindly retried.
- Timeout, HTTP 408/429/5xx, and recognized socket failures are transient for provider health. Other HTTP 4xx and explicit provider rejections are permanent. SMTP 4xx reply codes are treated as transient and SMTP 5xx as permanent for provider health. A permanent response interrupts a transient failure streak.
- A provider acceptance receipt is not proof of final inbox or handset delivery. Review delivery callbacks, suppression records, and the destination before concluding that the customer received a message.

## SMTP

**Timeouts.** The configured connection timeout defaults to 10 seconds and is capped at 10 seconds in the sender. The configured command timeout defaults to 15 seconds and is capped at 15 seconds. The whole email send has a 25-second signal deadline. TLS is required; the configured mode is immediate TLS or STARTTLS.

**Signatures.** SMTP 4xx reply codes and timeout/socket failures indicate a retryable outage. SMTP 5xx reply codes and an explicit recipient rejection indicate a permanent failure. Authentication failures, invalid sender domain, and certificate or network-guard errors require configuration repair, not repeated manual sends. The admin test result gives a sanitized cause.

**Throttling.** The application has no separate SMTP messages-per-minute setting. Use the lower of the account's contracted rate and the server's advertised limit. If the host rate-limits or defers with a 4xx response, allow the bounded worker backoff; coordinate a lower upstream send rate or alternate provider before retrying dead letters.

**Recovery.** Verify host, port, TLS mode, sender domain, and credentials in a new draft; run its test send; activate it if the active provider cannot recover. Escalate TLS/auth failures to the mail host owner. After an outage, watch queue age and the first live recovery probe.

## Resend

**Timeout.** HTTP sends use a 25-second deadline and an idempotency key. A successful API response returns a provider receipt. Delivery webhooks can later report final delivery or suppression outcomes.

**Signatures.** HTTP 408, 429, and 5xx are transient. Other 4xx responses, especially credential, sender-domain, or payload rejection, are permanent. Missing or contradictory receipts are uncertain and require reconciliation. Never paste API keys or webhook signing secrets into an incident report.

**Throttling.** The application does not hard-code a Resend quota. Compare 429 responses with the account's current limit and usage. Let the bounded retry ladder spread queued sends; if throttling persists, reduce the upstream burst or request a provider limit change. Do not repeatedly replay dead letters during a rate limit.

**Recovery.** Verify the key, sending domain, webhook configuration, and account status using a new draft and test send. Escalate account restrictions or sustained 5xx to Resend support through the account. Activate a validated alternate provider if needed, then watch callback outcomes and queue depth.

## SMS.ir

**Timeout, throughput, and credit.** The configured send timeout defaults to 15 seconds; credit checks have a 15-second cap. The configured throughput limit defaults to 100 messages per minute and is enforced per active provider in PostgreSQL. Set it no higher than the account's contracted capacity. The worker reads credit at least every six hours and moves a stale check forward after a successful send, capped to one check per 15 minutes. The staff page shows the last measured balance and time. Below the configured threshold it shows a low-credit alert until a later reading recovers. A threshold of zero disables the alert.

**Signatures.** HTTP 408, 429, and 5xx are transient. Other HTTP 4xx, including invalid credentials, are permanent. A non-success SMS.ir response status without a receipt is an explicit rejection and is dead-lettered. A conflicting status/receipt or missing receipt is uncertain and must be reconciled. Invalid destination, template ID, sender line, or variable mapping needs a corrected draft.

**Rate-limit recovery.** When the application quota is reached, wait for the one-minute window or lower the configured throughput in a validated replacement. For provider HTTP 429, check the account contract and provider status before resuming. Do not bypass the limiter or replay uncertain sends. If credit is low, replenish it through the approved account process and verify the balance with the provider.

**Escalation.** Page the on-call operations owner when OTP messages cannot be sent. Escalate credential, sender-line, template, quota, or credit problems to the SMS.ir account owner and provider support. After repair, verify a draft test send, activate the configuration if changed, and watch the live circuit recovery probe and queue age.
