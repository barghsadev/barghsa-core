# Solar document workflow batch

Canonical scope: `03-core-business.md#T-03.12.01.01`–`.04` and `T-03.12.02.01`–`.06`.

Customers can upload multiple documents, images, and videos to a solar construction request through the existing owned upload and immutable storage pipeline. They see admin-editable bilingual guidance and suggested files, but no minimum document count is enforced. The "I have uploaded all documents" action submits even an empty set for staff review. Customers may replace or soft-delete their own files after submission; document lineage, revisions, and events remain. Staff have a request queue with file preview, uploader, time, state, and separate per-file approve/reject actions. A rejection leaves the overall request open. Staff can request another file and later advance a sufficient set to the postal stage. Customer notifications and audits record decisions and transitions.

The document lifecycle migration adds solar request ownership checks while preserving the existing saving-order soft-delete rule. The new `solar_document_requests` table retains staff requests for additional files. The postal record is initialized at handoff; shipment and receipt actions are the next batch.

Validation: migrated HTTP tests use real Minio bytes for upload, empty submission, guidance, replacement lineage, post-submission removal, independent file decisions, notifications, and postal handoff. Existing document HTTP tests and related customer UI/document workspace tests were run. Root build, typecheck, lint, formatting, schema snapshot, OpenAPI contract, and backlog validation were run.
