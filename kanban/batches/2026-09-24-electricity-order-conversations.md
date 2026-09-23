# Electricity order conversations

Canonical scope: `03-core-business.md#T-03.07.04.02` customer order comments and `03-core-business.md#T-03.90.04` separation of public replies from internal staff notes.

Customers and staff can now exchange append-only comments on a submitted electricity order. The customer page shows only public replies; staff must explicitly choose public or internal visibility for every message. Public staff replies notify the customer without including the message body in the notice. A paginated staff conversation view keeps orders reachable after they leave the review queue. Authorization, step-up for staff writes, idempotency, rate limits, audit records, database checks and an immutability trigger protect the thread.

The new thread reuses the saving-order comment component. Real PostgreSQL pagination tests found that the existing saving cursor lost timestamp microseconds when parsed as a JavaScript `Date`; both services now keep the database timestamp as text for cursor comparisons.

The previous `main` CI run also exposed a stale contracts-navigation test that expected the route's component to be `ContractsPage` directly, although the route now wraps it to apply the active-contract filter. The test now checks that the matched route has a component while retaining its navigation and pending-state assertions.

Validation: focused and full electricity order integration tests, saving-order submission/comment integration, customer/staff web tests, i18n tests, workspace build and typechecks, changed-file lint, formatting, generated OpenAPI and database snapshot checks, and kanban validation. Direct `main` CI remains to be verified after push.
