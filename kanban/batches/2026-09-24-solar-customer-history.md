# Solar customer history — September 24, 2026

Canonical scope: customer-readable state history for `03-core-business.md#T-03.11.04.01` and the cross-workflow history requirement in `T-03.90.04`.

The authorized solar detail endpoint now returns the request's committed lifecycle events in time order. It whitelists customer-safe event names and timestamps from the existing audit trail; staff identifiers, notes, reasons, IP addresses, and raw metadata stay private. The customer detail renders a dated timeline with English and Persian labels for document review, postal handling, final decisions, and contract creation. A missing historical audit record falls back to the known submission time.

An indexed audit lookup keeps reads bounded to one request even as the audit table grows. The migration adds that index without changing existing audit rows.

Validation: migrated solar HTTP coverage checks event order, field allowlisting, and profile isolation; a bilingual customer browser journey checks the timeline across five browser projects. API/web/DB/i18n typechecks and builds, targeted lint and format, migration snapshot, OpenAPI contract, and backlog checks pass locally.
