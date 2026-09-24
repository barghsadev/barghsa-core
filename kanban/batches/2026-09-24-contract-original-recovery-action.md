# Staff contract original recovery action

Canonical scope: `05-notifications-documents-ai.md#T-05.11.05` and `05-notifications-documents-ai.md#T-05.11.07`.

The contract document list already shows a quarantined original, but its detail hid **Replace document**. Staff can now open the replacement upload from that original. The existing upload form carries the same contract, version, role, and predecessor ID to the API. Customers and staff viewing other quarantined document roles still cannot take this replacement action. The API and database recovery path was delivered in the preceding batch.

Validation: the document workspace component suite passes (13 tests), including staff-original, staff-signed, and customer-original cases. Web typecheck, changed-file lint, and formatting pass locally.
