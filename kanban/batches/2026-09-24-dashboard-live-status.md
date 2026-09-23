# Customer dashboard live status

Canonical scope: `02-auth-users-admin.md#T-08.01.03`, refreshed for the current electricity, saving and contract workflows.

The customer dashboard previously derived active contracts from `orders.status='CONFIRMED'` and pending orders from `orders.status='PENDING'`. Those legacy values can disagree with the authoritative contract, electricity and saving lifecycle states. The contract card also opened the electricity catalogue; the order card opened the catalogue with a status parameter it did not use.

The dashboard now counts `Active` contracts directly. It counts pending electricity and saving orders from their workflow states, plus legacy pending orders without a corresponding workflow record. Each query is scoped to the active profile and its permission. The contract card opens the contract list; the order card offers direct links to the electricity and saving order lists. Labels are updated in Persian and English.

Validation: focused dashboard API tests (5), bilingual card navigation tests (2), i18n tests (53), API/web/i18n typechecks, changed-file ESLint and formatting, and the root production build passed locally. The CI result for the direct `main` push should be checked separately.

The list-level pending filter was completed in the follow-up [dashboard pending-order lists](2026-09-24-dashboard-filtered-orders.md) batch.
