# Electricity contract to order return

Canonical scope: `07-ui-ux-design.md#T-07.18.03.01`, linked-order navigation from the customer contract detail.

The customer contract detail API now returns its stored source order ID after the existing publication and profile authorization checks. An electricity customer can return from a published contract to the linked order detail using a bilingual link. Contracts without a linked order have no link, and staff remain in their own workspace. No order or contract state changes.

Validation: PostgreSQL contract review integration tests verify the order ID stays private before publication and across profiles. Contract workspace unit tests and the bilingual Chromium activation journey verify the route. Workspace build, typecheck, lint, formatting, and backlog validation run before push; GitHub CI runs on the pushed commit.
