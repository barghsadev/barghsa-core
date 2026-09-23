# Power-saving hardware inventory batch

Canonical scope: `03-core-business.md#T-03.10.03.01`–`.03`.

Hardware inventory tracking is optional and configured per product by catalogue staff: on-hand count, tracked/untracked mode, and reservation period. The admin screen shows open reservations and refuses settings that would put on-hand stock below reserved units or disable tracking with open reservations. Every configuration change is audited.

When tracking is disabled, the customer catalogue and order form say availability depends on staff confirmation. Tracked hardware shows stock status and disables out-of-stock choices. Submission reserves one unit in the same transaction as the saving order. Product-row locking prevents concurrent orders from overselling stock. Payment or staff approval allocates a unit, exactly once. Rejection or cancellation releases a reservation or returns an allocated unit. The worker expires timed-out reservations every minute; later approval or payment must reacquire available stock. Reservation changes are audited, and all stock counters have database constraints.

Validation: migrated order HTTP flow covered admin configuration, full reservation, out-of-stock conflict, allocation on approval and payment, unpaid and paid rejection release, timeout expiry and reallocation. Saving catalogue API, catalogue product API, customer UI, i18n and shared background-job tests were run. Root build, typecheck, lint, schema snapshot, OpenAPI contract and backlog validation were run for this batch.
