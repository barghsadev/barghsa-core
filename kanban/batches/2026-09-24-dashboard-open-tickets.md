# Dashboard open-ticket list

Canonical scope: `02-auth-users-admin.md#T-08.01.03` customer quick-status navigation.

The dashboard counts non-terminal tickets belonging to the signed-in user on the active profile. Its ticket card opens `status=active&scope=active`; the customer ticket endpoint resolves the accessible active profile on the server and applies both profile and status filters to the count and page queries. The bilingual ticket page shows the active filter, explains the profile scope, and links back to all tickets. Existing ticket deep links remain valid.

Validation: focused API unit tests and a real PostgreSQL/HTTP pagination test, dashboard card tests in both locales, API/web typechecks, changed-file lint and formatting, i18n tests, OpenAPI contract check, root production build, and kanban validation passed locally. Verify direct `main` CI separately.
