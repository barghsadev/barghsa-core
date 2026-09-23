# Solar postal workflow batch

Canonical scope: `03-core-business.md#T-03.12.03.01`–`.06`.

Staff can edit bilingual postal instructions, destination, contact details, and the list of original documents to send. Customers see those instructions on their solar request, upload an optional receipt image through the existing document storage flow, and record courier, tracking number, and send date. Staff see a postal queue with shipment details and receipt preview. They can confirm receipt or mark a shipment incomplete or not received with a reason. Those two issue decisions leave the request open for resubmission; receipt advances it to `postal_documents_received`. The request page distinguishes waiting, shipped, received, incomplete, and not received states. Changes are audited, and staff decisions notify the customer.

The shared document service accepts customer receipt images during the editable postal stage while keeping reviewed document replacement and shipment-locked files closed. No new database migration is required because the postal table was created with solar request intake.

Validation: migrated HTTP tests cover guidance, ownership, real Minio receipt upload, invalid receipt rejection, shipment locking, both issue decisions, resubmission, receipt confirmation, and notifications. Existing solar document and generic document HTTP tests, customer postal UI and document workspace tests, root build, typecheck, lint, formatting, OpenAPI contract, and backlog validation were run.
