# Customer knowledge assistant

Task context: `05-notifications-documents-ai.md#T-05.22.04`, `05-notifications-documents-ai.md#T-05.23.01`, and `07-ui-ux-design.md#T-07.20.01.01`–`T-07.20.01.04` (read-only slice; the full chat and tool tasks remain open).

Signed-in customers with an active profile can ask single-turn questions through a Persian-first sheet in the dashboard. The launcher appears only when that profile's individual or legal chatbot slot has an enabled agent, a tested model, and a ready customer/public knowledge base. The panel identifies the active profile type, states that account records are unavailable, suggests general questions, and shows answer passages with KB and document names. It works in RTL and LTR layouts and keeps the answer visible when the panel closes.

The server chooses the slot from the active profile. Clients cannot supply a profile, slot, or agent. Each question is limited to published customer/public sources linked to that agent; the server rechecks the profile, assignment, source publication and link before returning an answer or replaying it. No customer records or prior conversation turns enter the model prompt. A question without a retrieved source fails before inference. The shared model circuit breaker and policies still apply, and the prompt requires the answer language to follow the question.

Five questions per minute are admitted per user and profile, with session-bound idempotency. Three PostgreSQL advisory slots bound concurrent inference across API replicas; saturation returns a clear retryable error without consuming quota. Question records expire after one day, and new requests remove expired records in small batches. Every accepted or failed question writes a redacted AI audit event. The CI compatibility fix updates the controller unit test for the KB's new default `admin` audience.

This is a complete, read-only shared-knowledge feature. It does not fetch invoices, orders, balances or profile data for the model, execute tools, stream tokens, or provide multi-turn continuity. Those remain separate kanban work, including the dedicated AI worker called for by the full capacity-isolation story.

Validation: 29 focused API tests, 15 browser cases across desktop and mobile browsers, root build, typecheck, lint, formatting, OpenAPI contract, database snapshot, suppressed-error and backlog checks passed. The prior CI unit-test expectation for the KB default audience is included in the focused API run.
