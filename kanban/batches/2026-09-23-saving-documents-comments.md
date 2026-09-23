# Power-saving documents and comments batch

Canonical scope: `03-core-business.md#T-03.10.02.01`–`.03`.

Customers can attach multiple PDFs, images, and videos to a saving order. Each file uses the existing presigned upload, server-side type and size validation, immutable storage copy, document state history, and quarantine flow. Customers can replace or soft-delete only their own available (unsubmitted) files; submitted files remain retained. Staff with saving-order permissions can view and work on documents for an exact saving order without gaining access to unrelated order documents. The order detail screens show the same files to customers and staff.

Customers and staff can post comments on a saving order in chronological order. Each comment records its author and time and cannot be updated or deleted. Writes are idempotent and audited. A staff reply creates an in-app notification for the customer. Both screens include the comment thread and pagination.

Migration 0163 adds append-only saving-order comments, permits the video document category, and narrowly allows `Available` → `Removed` for customer-uploaded saving-order documents while retaining the existing document lifecycle guard.

Validation: migrated HTTP tests covered the saving-order comment exchange, retry, notification and immutable history, plus real PDF/video upload, replacement, soft deletion, submission guard and staff permission scope. API, web, i18n, database snapshot, OpenAPI contract, backlog validation, root build, typecheck, lint, formatting and web tests passed. The storage pipeline records scanning as `not_configured` where no malware scanner is deployed; MIME/content checks, quarantine actions and retention remain active.
