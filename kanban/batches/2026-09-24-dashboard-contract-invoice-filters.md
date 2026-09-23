# Dashboard contract and invoice filters

Canonical scope: active-contract and unpaid-invoice navigation in `02-auth-users-admin.md#T-08.01.03`.

The active-contract dashboard count now uses only published active contracts, matching the customer-visible list. The card opens `state=Active`; the customer contract API filters in SQL before its cursor limit, and the page offers active/all navigation. The unpaid-invoice card opens `status=unpaid`; its API uses the same payable-invoice predicate as the dashboard count, excluding credit adjustments, while retaining the active-profile authorization check. Both pages offer an unfiltered view and bilingual empty/filter labels.

Validation: focused migrated HTTP integration cases for an activated contract and unpaid invoice corrections, 41 related API unit tests, 19 related web tests, API/web typechecks, changed-file lint/format, i18n tests, OpenAPI contract check, root build, and kanban validation passed locally. Verify the direct `main` CI result separately.

The matching open-ticket navigation is tracked in [the next dashboard batch](2026-09-24-dashboard-open-tickets.md).
