# Staff electricity order and contract handoff

Canonical scope: linked record navigation within `07-ui-ux-design.md#T-07.18.03.01` and `07-ui-ux-design.md#T-07.18.03.04`.

Staff can open the exact contract from an electricity order, and open the exact electricity order from either the contract list or its detail. The staff order page accepts an `orderId` URL parameter and loads that order directly, including orders that are no longer in the review queue. Links and labels work in Persian and English. The existing contract detail endpoint and permission checks remain authoritative.

Validation: focused frontend tests for both navigation directions, including a completed order outside the review queue; production build, typecheck, lint, format, and backlog checks before the direct `main` push.
