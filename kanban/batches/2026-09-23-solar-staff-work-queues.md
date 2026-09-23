# Solar staff work queue access — September 23, 2026

Canonical scope: `03-core-business.md#T-03.12.02.01` and the staff handling in `T-03.12.03.03`–`.05`.

The document review and postal dashboards now load older work on demand, keeping earlier rows visible. Their staff APIs return stable 100-row pages with an optional UUID cursor and validate that a cursor still belongs to the relevant stage. Both queries order by creation time and ID and preserve PostgreSQL timestamp precision for the boundary. Staff actions refresh the first page so completed work leaves the queue.

Validation: focused solar document and postal HTTP flows, both dashboard pagination tests, API/web typechecks and builds, OpenAPI snapshot comparison, targeted lint/format, and backlog check. CI status follows the direct `main` push.
