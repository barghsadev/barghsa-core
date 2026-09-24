# Invoice receipt bank name

Canonical scope: receipt list/detail metadata in `07-ui-ux-design.md#T-07.18.03.03` and invoice receipt submission in `04-invoices-wallet-contracts.md#S-04.3.01`.

Customers can add the bank name shown on an invoice receipt. The upload parser trims and bounds the value, and retries with the same attachment require matching metadata. A nullable `bank_name` column and database length check preserve older receipts and older clients. Customer invoice history and finance pending/history/detail views show the name when known; legacy rows show a dash in finance views. The customer upload API contract documents the optional field.

Validation: shared parser and retry tests, migrated PostgreSQL upload and history tests, customer/finance UI tests, and a legacy-row migration test. Workspace build, typecheck, lint, formatting, OpenAPI, migration baseline/snapshot and backlog checks run before push. GitHub CI runs on the pushed commit.

No bank name is inferred for existing receipts. This field is optional because the old application version can still submit receipts during the schema expansion.
