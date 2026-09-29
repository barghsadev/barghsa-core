# AI policy priority and inference evaluation batch

Tasks: `05-notifications-documents-ai.md#T-05.18.01`,
`05-notifications-documents-ai.md#T-05.18.02`, and
`05-notifications-documents-ai.md#T-05.18.03` for the available admin inference path.

Policies now store bounded priority (lower runs first) and support input/output
content terms, response format, and per-user rate limits alongside the existing
topic, action, scope, and style rules. A policy-group membership can override
the policy priority without changing other groups. The bilingual editor exposes
these fields, and changes are audited.

Admin test chat resolves enabled direct and group policies at each request.
When a policy is linked more than once, its lowest effective priority wins.
Denials and data scopes compose restrictively; the first priority wins for
conflicting tone, language, and output format, while the shortest response
length wins. The API blocks invalid stored
rules, disallowed input, filtered or malformed output, conflicting scopes, and
over-limit requests with a stable code, reason, and policy reference. Scoped
requests omit prior conversation history so a newly tightened scope cannot
replay replies generated under broader access. Failed output is never stored as
a completed turn.

This evaluates the only currently available agent inference endpoint, the
staff-only test chat. Production customer/staff chat slots and AI tool actions
are not yet implemented; those later endpoints must call the same evaluator
and enforce their own authorization before being considered policy-protected.
Term matching is literal, not semantic moderation.

Validation: migrated PostgreSQL HTTP tests for CRUD, priority overrides and
runtime enforcement; policy unit tests; bilingual Chromium policy editor;
database snapshot, OpenAPI contract, build, typecheck, lint, formatting and
kanban validation.

The optional full route-budget check still fails on existing login, register,
password recovery, dashboard, electricity ordering, and admin terms routes.
The policy editor route remains below its budget. The current fast CI mode
does not enforce the full route-budget check.
