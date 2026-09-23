# Effective-dated electricity limit history — September 23, 2026

Canonical task: `03-core-business.md#T-03.90.08` (remaining electricity-limit portion). Product prices and VAT already use effective-dated versions, and submitted orders already freeze their price and VAT values.

Every insert or changed update to an electricity product's kWh limits now closes the prior effective window and appends a non-overlapping version. The migration records each existing live limit as a baseline from migration time; earlier limit history cannot be reconstructed. Admin product detail shows the dated limit history. New electricity submission snapshots include the min/max limits actually used in the quote, so subsequent admin changes cannot alter the submitted order's record. No-op updates create no version.

The same additive migration attaches the required `updated_at` trigger to the saving-draft table introduced in 0179. This resolves the database-foundations CI failure for the preceding draft batch. The preceding batch's unformatted web test was formatted as well; the downstream coverage job failure was caused by those two failed jobs.

Validation: 80 related API catalogue and electricity tests, database foundations (5), migration baseline (2), all 970 web tests, 53 dictionary tests, API/web/database typechecks, production web build, database snapshot and OpenAPI checks, root lint, root format check, and backlog validation passed locally. CI is pending after the direct `main` push.
