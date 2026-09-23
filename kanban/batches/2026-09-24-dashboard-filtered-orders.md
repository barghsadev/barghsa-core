# Dashboard pending-order lists

Canonical scope: finish the filtered-list navigation detail of `02-auth-users-admin.md#T-08.01.03` for electricity and saving orders.

The dashboard's in-progress count now links to `status=pending` on each order list. Both APIs validate this optional filter, apply workflow states in SQL before cursor pagination, and reject cursors that do not belong to the filtered set. The customer pages show the filtered result and a route back to all orders. Persian and English copy includes the filter and its empty state.

Validation: focused migrated HTTP integration cases for electricity and saving, five related web tests, API/web typechecks, changed-file lint and formatting, i18n tests, OpenAPI contract check, production build, and kanban validation passed locally. Check the direct `main` CI run separately.

The separate route-budget command still reports existing over-budget login, register, password-recovery and electricity-ordering routes. The dashboard route remains within its budget; this batch does not expand those existing routes.
