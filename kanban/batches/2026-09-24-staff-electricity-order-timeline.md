# Staff electricity order timeline

Canonical scope: the order timeline in `07-ui-ux-design.md#T-07.18.03.04` and the shared status presentation in `07-ui-ux-design.md#T-07.27.01.02`.

Staff order detail now shows the saved order, review, cancellation, and contract lifecycle events with localized labels, account-timezone timestamps, and recorded reasons or comments. It remains available when a linked order has left the review queue. The customer timeline now includes the initial submission event, which is stored as `order_created` and was previously omitted by the electricity-only event filter. Both views share one event-label mapping.

Validation: PostgreSQL HTTP tests cover submitted and approved staff history plus the customer submission event. Focused frontend tests cover staff timeline rendering and existing customer detail behavior. Production build, typecheck, lint, formatting, OpenAPI, and backlog checks run before the direct `main` push.
