# Consultation staff workflow batch

Canonical scope: `03-core-business.md#T-03.03.01.02`–`03`, `03-core-business.md#T-03.03.02.05`, `03-core-business.md#T-03.03.03.01`, `03-core-business.md#T-03.03.03.04`–`06`. The fee offer, invoice, acceptance, payment, and completion transitions remain in the next batch.

Staff can filter an open consultation queue by status, assignment, priority, and age; inspect customer and status history; assign a request to themselves or an active team; request customer information; and reject or cancel with a reason. Customers can provide the requested information and return a request to review. Mutations enforce the consultation state transitions under a row lock, record an append-only event and audit entry, and create in-app status notifications in the same transaction. The customer detail page exposes the requested-information response action. Persian and English text covers the new surfaces.

Validation: HTTP integration covered staff access, the queue, self and team assignment, information exchange, rejection, history, and notifications. Focused consultation tests, root build, typecheck, lint, format, backlog, and OpenAPI contract checks passed.
