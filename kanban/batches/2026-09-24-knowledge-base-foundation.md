# Knowledge-base configuration and groups batch

Tasks: `05-notifications-documents-ai.md#T-05.17.01` and
`05-notifications-documents-ai.md#T-05.17.03`.

Knowledge bases now store a document, HTTPS web-page, or HTTPS API source,
chunk size and overlap, embedding-model name, content state, error, and
enabled state. `kb_chunks` stores passages and optional 1536-dimensional
pgvector embeddings, with an HNSW cosine index. Existing KBs migrate as
disabled document sources. Staff can edit these settings in the bilingual
admin page. A source change invalidates old chunks and document processing
state; a title edit preserves ready content. Adding or removing a document
also invalidates the old index. A KB cannot be enabled until processing has
made it ready.

The existing KB group schema, membership API, step-up controls, and bilingual
admin UI were reviewed and exercised by the focused API and browser suites.
No duplicate group implementation was needed.

Validation: KB database schema test, KB service/controller/HTTP tests,
database snapshot check, and eight bilingual Chromium KB browser cases pass.
The next batch is T-05.17.02: safe source extraction, chunking, embedding,
and processing-state transitions. Until then new KB content stays empty and
cannot be enabled.
