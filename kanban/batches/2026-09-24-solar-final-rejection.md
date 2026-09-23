# Solar final rejection — September 24, 2026

Canonical scope: the terminal `rejected` outcome and its required reason/support path in `03-core-business.md#T-03.11.04.01` and `.03`.

After staff confirm receipt of original postal documents, an authorized reviewer can reject the solar request with a required reason. The decision is confirmed in the staff UI, locks the request, records `rejected` with the trimmed reason and support route, writes an audit event, and notifies the customer in Persian and English. A rejected request leaves the staff final-decision queue and cannot be approved or rejected again. Approval and elevated close-without-contract keep their existing behavior. No contract or invoice is created by rejection.

The browser test exercises the staff reason and confirmation flow with controlled API responses. Migrated HTTP integration covers premature and unauthorized rejection, reason validation, final state, customer detail, notification, audit record, and replay conflict. This batch does not introduce a separate `final_review` intermediate state.

Validation: focused migrated solar HTTP suite, five-browser staff rejection journey, API/web/i18n typechecks, API and web production builds, generated OpenAPI drift check, targeted lint and formatting, dictionary tests, and backlog validation.
