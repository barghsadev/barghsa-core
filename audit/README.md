# Retained migration and verification inputs

Task and release status moved to [the current kanban](../kanban/README.md). This directory is not a progress tracker.

Only four historical inputs remain because current database code, tests or immutable migrations reference their exact paths:

- `legacy-inline-constraints.json`: database constraint inventory consumed by the checker and tests.
- `staff-administrator-review.sql`: administrator authority reconciliation query consumed by integration tests.
- `notification-template-history-review.sql`: template lineage review referenced by migration 0117.
- `schema-snapshot-review.md`: schema checkpoint referenced by immutable migration 0118.

Operational preflight instructions moved to `docs/operations/preflight/`. Removed audit logs, plans, status snapshots and reports remain in Git history at `fcd7678ba742fbbaa7cd0907471f3f2aec86bb82`. Reconciled acceptance and batch evidence are in `kanban/board.json`. See [reconciliation notes](../kanban/RECONCILIATION.md) for the recovery snapshot and status limitations.
