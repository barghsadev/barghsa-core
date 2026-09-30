# Notification inbox context isolation

Task context: `02-auth-users-admin.md#T-11.02.01` and `02-auth-users-admin.md#T-11.02.02` (notification slice).

Both notification APIs now partition list, count, single-read and read-all operations by the authenticated session's operating context. Staff notices require current staff eligibility and the addressed account; customer notices retain active-profile ownership checks. Account-security notices remain available in either context. A dual-role user receives separate staff and customer notices when an event is relevant to both.

Migration 0227 adds the context column, classifies known existing notices by event and destination, and installs a fallback for older SQL functions that still insert without the new column. Unknown legacy account-only notices stay hidden pending classification. API, database and worker writers set an explicit context; the worker rejects unclassified account-only deliveries and staff notices without an account recipient. Delivery retries also bind the saved context and event type.

Validation: API dual-role PostgreSQL/HTTP inbox tests for both endpoints and read actions, SQL-function fallback and revoked-staff access; existing profile-switch tests; worker transport and historical-migration integration tests; migrated refund-processing tests; notification-template HTTP tests; API and worker typechecks/build; database snapshot check. The unrelated standalone route-budget check remains over limit on pre-existing routes.
