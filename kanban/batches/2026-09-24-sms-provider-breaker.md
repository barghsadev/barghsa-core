# SMS provider circuit breaker

Canonical scope: `05-notifications-documents-ai.md#T-05.08.01` and `05-notifications-documents-ai.md#T-05.08.02` (SMS transport portion).

SMS notification and authentication sends now share the persisted provider breaker used by email. Five transient SMS.ir failures inside five minutes open the circuit; sends then stop before provider I/O. After a one-minute cooldown, one leased send can probe recovery. A successful probe clears the breaker. Provider HTTP status is preserved for safe transient classification, so 401/other permanent HTTP responses do not trip it. Existing delivery ownership and quota checks remain in place.

Migration `0200` adds SMS breaker state without changing provider lifecycle status or existing configuration. The state survives worker restarts and is shared across replicas.

Validation: the SMS/PostgreSQL integration test checks trip, refusal, recovery and permanent rejection; existing email breaker, SMS adapter, auth worker and migration-baseline suites pass. Provider health dashboard, alert history, and permanent-error dead lettering remain separate criteria of Story T-05.08.
