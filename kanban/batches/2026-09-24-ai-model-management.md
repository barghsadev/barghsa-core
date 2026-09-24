# AI model management and connection evidence batch

Tasks: `05-notifications-documents-ai.md#T-05.16.01`,
`05-notifications-documents-ai.md#T-05.16.02`, and
`05-notifications-documents-ai.md#T-05.16.03`.

The existing admin model CRUD and worker-backed connection test now include
bounded generation settings, an explicit enabled state, and the last test's
latency. A new model starts disabled; a passing connection test is required
before staff can enable it or activate an agent using it. Editing a provider
destination, model name, token, or request settings invalidates that test and
disables the model. A failed repeat test also disables it. Previously tested
models remain enabled during migration.

The bilingual admin page shows test evidence and enable/disable controls,
edits request defaults, and names dependent agents when deletion is blocked.
The worker sends a short model-specific probe; its safe preview remains
available in the admin page. API tokens remain encrypted, write-only and
masked in responses.

Validation: AI-model and agent HTTP suites, provider transport tests, admin
page test, build, typecheck, lint, formatting, database snapshot and OpenAPI
contract checks. Circuit-breaker integration remains T-05.16.04.
