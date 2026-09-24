# Agent configuration completion batch

Tasks: `05-notifications-documents-ai.md#T-05.19.01`, `T-05.19.02`, and
`T-05.19.03`.

The existing agent CRUD, model references, KB and policy links, group links,
and bilingual editor now include the missing inference settings: system
instructions, optional temperature and token-limit overrides, and KB link
mode. Database and API constraints keep these settings bounded. Existing
agents migrate with an empty prompt, model defaults, and `any_kb` mode.

Deleting an agent assigned to a chatbot slot now returns a clear conflict
with the slot keys; staff must explicitly unassign it first. Configuration
changes remain step-up protected and audited without recording prompt text in
the audit metadata.

Validation: agent API unit and migrated PostgreSQL HTTP suites, bilingual
Chromium editor flows, DB schema snapshot, OpenAPI contract, build, types,
lint, format, and queue validation passed locally. Runtime application of
these settings and the isolated test chat belong to T-05.21.
