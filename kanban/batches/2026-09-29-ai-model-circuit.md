# AI model circuit breaker batch

Task: `05-notifications-documents-ai.md#T-05.16.04`, applied to the current
admin preview inference and worker connection-test paths.

Each model has a separate persisted circuit state. Five successive provider
failures within five minutes open that model's circuit for a minute. Calls
then return a platform-level `AI_MODEL_CIRCUIT_OPEN` response before contacting
the provider. After cooldown, one caller claims a recovery probe using the
same guarded connection test as the admin test button; the circuit closes only
after the requested completion also succeeds. An authorized manual
test may also close an open circuit. A failing test contributes to the model's
failure history.

Breaker state lives in its own table so health transitions do not change the
model configuration revision used to fence queued tests. Stale or cancelled
worker results cannot reset it. Durable open/recovered events, the
`ai_model_health{model_id}` Prometheus gauge and an alert rule expose failures
to operators. The bilingual admin model list distinguishes a current open
circuit from the stored result of its last manual connection test.

Future production chat/tool inference paths must use this breaker wrapper.
This batch does not isolate preview inference into a dedicated worker; that
remains `T-05.23.01`.

Validation: migrated PostgreSQL API, worker and metrics tests; admin page unit
tests; root build, typecheck, lint, formatting, contract, database snapshot and
kanban checks. The alert rule and test fixture are YAML-validated locally;
`promtool` is unavailable on this host, so alert evaluation awaits CI/runtime
validation.
