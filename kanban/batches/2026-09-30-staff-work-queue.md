# Staff dashboard work queue

Canonical work: `07-ui-ux-design.md#T-07.19.02.08` (`StaffWorkQueueWidget`).

The staff dashboard now groups four actionable counts: unresolved tickets, electricity orders awaiting review, saving orders awaiting review, and unassigned consultation requests. Each card links to its matching queue. Ticket-only roles see just their assigned unresolved tickets; roles without ticket, contract, or order access receive no count for those categories. The existing business-work request supplies the counts, so the widget adds no polling request. The former electricity card moved into this group rather than appearing twice.

The ticket queue accepts an active-status filter that matches the dashboard count, and the consultation queue reads its unassigned link filter on entry. Both links were exercised in Chromium. The previous dashboard batch's remote CI also completed successfully.

Validation: PostgreSQL-backed business-work and ticket HTTP suites (56 tests), staff queue and consultation web unit tests (7 tests), Chromium dashboard entry (4 tests), i18n tests (53 tests), root build/typecheck/lint/format, OpenAPI contract, all 64 route and interaction budgets, and generated backlog check.
