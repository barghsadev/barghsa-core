# AI preview redaction and attribution batch

Tasks: `05-notifications-documents-ai.md#T-05.22.05` and
`05-notifications-documents-ai.md#T-05.22.06`, implemented for the currently
available admin test-chat inference path.

The preview redacts recognized credentials, Iranian national IDs, bank card
numbers and IBANs before sending user text, retrieved passages or conversation
history to model and embedding providers. It also redacts saved turns and
returned answers. The pattern matcher returns the detected categories without
retaining matched values. Unrecognized secret formats can still escape; this
is a guardrail, not a guarantee that arbitrary text is safe.

Retrieved sources now include the KB name, attached document name when
available, and a redacted excerpt. The response distinguishes a reply with
retrieved context from general guidance, and the bilingual UI labels both
without claiming that generated text is factually proven by the passages.
An optional `requireSources` response-style rule blocks a reply before model
invocation when no passage is available.

Production chat slots and AI tools do not yet exist. They must use the same
redaction and attribution path, with profile authorization, before these tasks
can be considered complete across the full product.

Validation: pattern unit tests, migrated PostgreSQL HTTP tests with a local
model provider, bilingual Chromium editor/chat tests, build, typecheck, lint,
formatting, OpenAPI contract and kanban validation.
