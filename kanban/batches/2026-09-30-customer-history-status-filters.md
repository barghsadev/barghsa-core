# Customer history status filters

Canonical work: `07-ui-ux-design.md#T-07.18.02.01` (`StatusFilter`), plus the URL persistence and active-count/clear behavior from `07-ui-ux-design.md#T-07.18.02.04` and `07-ui-ux-design.md#T-07.18.02.05` on these three customer histories. Broader all-list coverage, other filter types, and list composition remain open.

Saving orders, solar requests, and consultation requests now share a bilingual multi-select status filter with colored labels, an active count, and a clear action. Selections use canonical comma-separated URL parameters and survive reload and browser Back. Changing the selection discards prior rows and cursors without discarding the consultation submission form. The existing saving pending-orders preset remains available.

All three APIs validate the same status allowlists and filter in PostgreSQL before applying the 100-row cursor page. Cursor lookup is also constrained to the selected statuses and authorized profile. Unknown or malformed filters return 400. The OpenAPI contract documents the new optional parameter. Submitted histories exclude draft from their filter options; form drafts remain separate.

The savings catalogue moved unchanged into a lazy-loaded page to keep the existing bundle budget. Electricity ordering measures 244.50 KB gzip against its unchanged 251 KB limit.

Validation: three PostgreSQL HTTP integration suites (10 tests), shared filter parser tests (7), full web tests (1,159), UI tests (60), translation tests (53), consultation state test, 30 bilingual filter flows across Chromium, Firefox, WebKit, Android and iPhone projects, existing saving/solar/consultation journeys, root build/typecheck/lint/format, OpenAPI contract, all 64 bundle budgets, and generated backlog validation.
