# Invoice bank-receipt finance history

Canonical scope: staff receipt list/detail pattern in `07-ui-ux-design.md#T-07.18.03.03` and the staff side of `04-invoices-wallet-contracts.md#S-04.3.01`.

The admin invoice receipt panel now has a separate reviewed-history view. Finance staff can filter confirmed or rejected receipts by exact invoice ID, page through 25 rows at a time, and reopen the original receipt detail, attachment, confirmation allocation or rejection reason. The list query uses a `(created_at, id)` cursor with full database timestamp precision and returns summaries without generating attachment URLs for every row. The existing permission check applies to history, and the API rejects malformed filters or half-cursors. Historical detail does not run a new allocation preview.

Validation: PostgreSQL integration covers a microsecond page boundary, terminal-state filtering, and invoice isolation. Controller tests cover permission and query validation. Web tests cover history paging, filters, and the terminal detail. Workspace build, typecheck, lint, formatting, OpenAPI and backlog checks run before push; GitHub CI runs on the pushed commit.

Remaining: bank-name metadata is not stored on invoice receipts, so the canonical bank-name column is still pending. The pending queue remains a separate live view.
