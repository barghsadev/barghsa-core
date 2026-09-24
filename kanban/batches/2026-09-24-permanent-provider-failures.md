# Permanent provider failures leave the retry queue

Canonical scope: `05-notifications-documents-ai.md#T-05.08.01` (provider outcome classification and notification retry behavior).

Notification dispatch keeps a structured provider error kind alongside its redacted error message. HTTP 408, 429 and 5xx responses, SMTP 4xx responses, timeouts and network failures remain eligible for bounded retry. HTTP 4xx credential and request errors, SMTP 5xx responses and explicit provider rejection are permanent: the channel job moves to the dead-letter queue after its first attempt, with `permanent` in its delivery log. Uncertain outcomes still require reconciliation before any retry. Other channels can complete independently.

Validation: classifier tests cover HTTP, SMTP, explicit rejection and unknown outcomes. Worker tests verify that a 401 SMS response dead-letters once and a 503 response keeps its scheduled retry. Shared and worker builds and focused suites pass. Provider alerting and admin health presentation remain separate Story T-05.08 criteria.
