# Knowledge-base processing

The worker polls KBs with new content every 10 seconds. It reads attached
documents from the configured private object store or fetches configured HTTPS
web/API sources, extracts text, splits it using each KB's chunk settings, calls
an OpenAI-compatible `/embeddings` endpoint, and stores 1536-dimensional
vectors in PostgreSQL pgvector. The database image must include pgvector; the
production image already does. URL sources reject private and reserved network
addresses at socket connection time and do not follow redirects.

Configure `KB_EMBEDDING_BASE_URL` and `KB_EMBEDDING_API_KEY` in the external
runtime environment file shared by API and worker. For a private deployment
endpoint, explicitly list its host in `AI_MODEL_BASE_URL_ALLOWLIST`. The staff
UI sets the embedding model name per KB. The provider must return 1536 numeric
dimensions for every input. A new KB starts disabled; staff can enable it only
after its content reaches Ready. A failed run records a safe error state;
**Reprocess** queues another run and removes the old index.

Supported uploads: UTF-8 TXT and CSV, text PDF, DOCX, and XLSX. Images and
scanned PDFs without a text layer need OCR before attachment. Each source is
limited to 8 MiB of input and 400,000 extracted characters; a KB is limited
to 500 chunks. Web responses are limited to 2 MiB. The worker does not retain
raw provider responses or log source contents. Staff may test KB and group
retrieval on the admin page; group tests search only ready, enabled members.

If processing stays in Processing after a worker interruption, the lease can
be reclaimed after five minutes. An edit or a newer lease changes the row
revision, preventing the older worker from publishing stale passages.
