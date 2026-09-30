# Customer dashboard active contracts

Canonical work: `07-ui-ux-design.md#T-07.19.02.07` (`ActiveContractsWidget`).

The active-profile dashboard now shows up to three currently active, published contracts with service type, contract number, status, end date, and elapsed term progress when both term dates exist. Missing term dates receive an explicit unavailable label. Each item opens the selected contract in the existing customer contracts page, and the widget links to the full active-contract list. Agents without contract-read permission receive no summary. The existing profile-revision guard prevents old-profile contract data from appearing after a switch, and all dashboard dates use the shared account timezone.

Dashboard-only invoice, order, and contract copy now lives in its own bilingual i18n entry, keeping it out of the electricity-ordering bootstrap. The prior batch's CI failure exposed a timing-sensitive invoice receipt test; its confirmation wait now allows the real asynchronous upload/review sequence to finish on slower runners.

Validation: PostgreSQL-backed dashboard HTTP integration, dashboard service tests, Chromium dashboard flow, all 1,148 web unit tests, dictionary tests, root build/typecheck/lint/format, OpenAPI contract, bundle budgets, and generated backlog check.
