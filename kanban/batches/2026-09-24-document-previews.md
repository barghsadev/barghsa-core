# Document preview derivatives

Canonical task: `05-notifications-documents-ai.md#T-05.09.04`.

Authorized customer and staff document detail views can request a small image preview without opening the full source file. The API reuses the document read boundary and refuses quarantined, pending, and removed documents. It renders JPEG, PNG, and WebP sources to a bounded PNG with Sharp and the first page of a PDF with Poppler. Source reads are capped at 15 MiB; PDF rendering has a ten-second deadline. Unsupported types have no preview.

Derivatives are stored only by the server under `previews/`, whose bucket lifecycle removes objects after seven days. The cache key includes the immutable sealed source key and the current day, so a replacement cannot reuse an old derivative and generated previews are refreshed daily. Returned S3 URLs expire after five minutes.

Validation: focused storage and UI tests, document HTTP integration with real PostgreSQL and S3-compatible storage, workspace build, typecheck, lint, format, and contract checks. The production API image installs Poppler for PDF rendering; PDF-specific test assertions run when that binary is present in a test environment.
