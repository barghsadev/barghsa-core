# Knowledge-base processing and test queries batch

Tasks: `05-notifications-documents-ai.md#T-05.17.02` and
`05-notifications-documents-ai.md#T-05.17.04`.

The worker now claims empty or abandoned knowledge bases, extracts bounded
text from attached TXT, CSV, PDF, DOCX and XLSX files or HTTPS web/API
sources, chunks it according to the saved settings, and calls a configured
OpenAI-compatible 1536-dimensional embedding provider. It publishes passages
and the ready state in one transaction. A source edit, document removal, or
another worker's lease prevents an old run from publishing; source and
provider failures leave an actionable error state. Staff can request audited
reprocessing after fixing a failure.

Admins can test a ready KB or an enabled, ready KB group with a query and see
ranked excerpts and source references in English or Persian. The query API
checks staff KB permission and bounds input, result count, and provider I/O.
Private destinations are blocked for web sources; an embedding provider on a
private or HTTP address needs an explicit host allowlist. Configuration and
recovery steps are in `docs/operations/knowledge-base-processing.md`.

Validation: focused shared embedding, worker extraction/processing, API KB,
and bilingual Chromium KB suites passed locally. The provider was exercised
with a local compatible fixture; a live production provider has not been
tested. Remaining agent use of KB groups is separate work.
