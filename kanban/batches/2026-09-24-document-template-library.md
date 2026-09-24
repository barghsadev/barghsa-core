# Staff document template library

Canonical scope: `05-notifications-documents-ai.md#T-05.10.01` through `T-05.10.05`.

Staff with document-edit permission can create a titled, categorized template and save versions containing PDF and DOCX files. Each new version selects which files from the current version to retain and which files to add. Omitting a file removes it from the new version without deleting the historical file or changing older versions. Files are stored as immutable S3 objects with checksums and short-lived download links. Writes require a current session, document-edit permission, recent step-up, and an audit record.

The API extracts `{{placeholder}}` tokens from text-based PDFs and DOCX XML, including tokens split across Word runs. It re-extracts retained files when creating a version, stores the merged list, shows missing system placeholders, and flags names used in different file contexts. Extraction limits input size, ZIP expansion, entry count, output text, and PDF page count. The bilingual admin page supports search, category filtering, metadata edits, file selection and drop, version history, placeholder review, and historical downloads.

Validation: real PostgreSQL and S3-compatible HTTP integration covers create, multi-file upload, replacement, removal, historical download, stale selection, invalid file rejection, and audit records. Focused extraction and admin interaction tests cover PDF/DOCX parsing, multipart CSRF submission, and English/Persian UI. Workspace build, typecheck, lint, format, OpenAPI, database snapshot, backlog, and dependency-audit checks are run before the direct main push.
