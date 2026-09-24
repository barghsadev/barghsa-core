# Staff invoice search by customer and order

Canonical scope: finance portion of `07-ui-ux-design.md#T-07.18.03.02`.

Finance staff can now search the invoice ledger by customer profile ID or source order ID, alone or together with invoice ID and lifecycle state. The filters carry through cursor pagination, and a new search clears the previous result and detail. All three identifiers are validated as UUIDs before the API queries PostgreSQL; the existing `invoices:read` permission still gates list and detail access. The search controls and validation messages are available in Persian and English.

Validation: controller and service tests cover combined filters and cursor parameters; a real PostgreSQL HTTP test checks matching and nonmatching orders, profiles, invalid input and permission; the staff component test checks filter submission and pagination. Production build, raw typecheck, lint, formatting, OpenAPI contract and backlog checks run before the direct `main` push. GitHub CI runs on the pushed commit.
