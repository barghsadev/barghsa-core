# Admin agent test-chat batch

Tasks: `05-notifications-documents-ai.md#T-05.21.01`, `T-05.21.02`, and
`T-05.21.03`.

Staff with agent-management permission can preview an enabled agent in a
separate, short-lived conversation. The API reads the saved model settings and
agent instructions, resolves direct and group KB/policy links, retrieves
enabled ready KB passages, and returns the reply with retrieved context,
applied policies, token counts and latency. `all_kbs` requires a passage from
every linked KB; `any_kb` uses the highest ranked passages. Test messages do
not enter production conversations or invoke customer tools.
The versioned `/api/v1/admin/ai/test-chat` endpoint accepts and returns the
epic's snake-case fields; the admin UI uses its camel-case alias.

Each browser submission carries a request ID. The backend replays a completed
request for the same session without a second model call or quota charge, and
rejects reuse with different content. A PostgreSQL rolling limit admits ten
requests per staff user per minute, returns `Retry-After` on 429, and reports
remaining quota in the bilingual chat UI. Turns expire after one day and the
worker removes expired rows hourly.

Policy enforcement here uses explicit term matching for allowed topics and
disallowed actions; data scopes permit `all` or `kb:<UUID>`; response-style
settings guide tone/language and cap response length. This preview does not
claim semantic moderation or action-tool authorization, which remain separate
AI safety work.

Validation: provider and policy unit tests, migrated PostgreSQL HTTP tests for
replay, quota and KB modes, bilingual Chromium chat/editor checks, database
snapshot, OpenAPI contract, build, types, lint, format and kanban validation.
