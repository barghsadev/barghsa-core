# Electricity order history pagination — September 23, 2026

Canonical scope: profile-scoped customer order history in `03-core-business.md#T-03.07.04.01`.

Loading an older page now appends distinct orders to the visible history. Previously, selecting “More orders” replaced the page already shown, so customers could not browse their order history as one list. Loading the first page still replaces any stale list after a fresh mount.

Validation: the focused order-list test loads two pages and confirms both orders remain visible with their financial status. Web typecheck, targeted lint and formatting, and backlog validation passed locally. CI is pending after the direct `main` push.
