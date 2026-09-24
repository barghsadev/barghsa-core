# Provider health visibility for staff

Canonical scope: `05-notifications-documents-ai.md#T-05.08.03` (current breaker state and last failure in provider administration).

The email and SMS provider lists now distinguish an active healthy provider from one whose circuit is open. Staff see the recovery time or that a probe is ready, plus the last failure time, in Persian and English. The SMS config API exposes the persisted breaker state; the email API adds its last failure time. Other provider lifecycle states stay separate from runtime health.

The prior notification CI run found an integration test expecting explicit SMS.ir rejection to retry. That test now verifies the intended permanent dead-letter behavior and confirms the same provider quota is shared with authentication. Transient failures remain on the bounded retry path.

Validation: 32 API provider tests, all 470 worker tests, 20 focused browser cases across five projects and two languages, build, typecheck, OpenAPI contract, lint, formatting and backlog checks pass. Latency percentiles, queue depth, failure rate and alert history remain separate Story T-05.08 criteria.
