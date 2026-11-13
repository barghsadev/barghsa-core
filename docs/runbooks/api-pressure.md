# API pressure

Check the environment and database in the alert before taking action. Open the private dashboard linked in the notice and follow the [service objectives](../operations/service-objectives.md) and [incident response process](../operations/incident-response.md).

## Elevated authentication failures

The P1 rule compares each sign-in stage separately. It requires at least 30 estimated rejections in a rolling five-minute window and a rejection ratio of at least 50% for five consecutive minutes. Password submissions count HTTP 401 as a rejection. OTP verification counts 401, 404 and 409. Both stages include HTTP 200 in the denominator. Review these initial thresholds against representative target traffic before accepting the live gate.

Check the sign-in, MFA, rate-limit and recent security-event panels in the Authentication and Security dashboard. Verify a normal sign-in with the dedicated customer fixture, then check provider delivery and recent releases. A sustained spike can reflect abuse, an expired challenge flow or customer impact. Use the scoped metrics and sanitized request references. Keep credentials, OTP codes, identifiers and device values out of incident notes. Verify fresh metrics and a successful sign-in before recording recovery.

## Application database pool saturation

Check `pg_pool_connections{state="active"}`, `pg_pool_capacity`, and `pg_pool_waiting_requests` by scrape target. The alert requires waiting requests and an at-capacity pool on the same target for two minutes. The notification groups affected replicas by environment and database. Compare the affected target with database query latency, lock waits, transaction duration, and recent deployments before changing connection limits. Increasing each replica's pool can exceed the database connection budget.

## Critical API route errors

Inspect the named method and registered route template in the API Health dashboard. Compare response status and latency across revisions. The rule counts completed HTTP 408 and 5xx responses as failures and HTTP 2xx and 304 responses as successes. It requires an estimated 20 eligible responses in the rolling five-minute window and five minutes above the tier's fast burn threshold. Check the independent synthetic probes for low traffic, interrupted connections, and requests that never reached the API. Check the journey budget dashboard for customer impact and follow any related P1 response.

Correlate sanitized request IDs with private logs and check the provider and database dashboards. For invoice or top-up failures, verify the existing operation and ledger receipt before retrying. Follow the [payment and wallet runbook](payment-wallet-mismatch.md) if payment state is uncertain.

Confirm recovery in the affected replica or route metrics and capture the firing and resolved operations receipts. If the alert stops during a gap in metrics, use collector and synthetic evidence to establish recovery.
