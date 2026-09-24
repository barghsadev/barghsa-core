# Staff electricity order lookup

Canonical scope: staff order detail access within `03-core-business.md#T-03.07.02.05` and the electricity detail composition in `07-ui-ux-design.md#T-07.18.03.04`.

Staff can enter an order ID to open the exact order, including historical orders outside the pending review queue. Selecting a queue item or looking up an ID updates the shareable URL. Refresh keeps the selected order and reloads its detail. Invalid IDs are rejected locally; a missing or unavailable order shows a recoverable detail error without disabling the queue or leaving an endless loading message.

Validation: focused frontend tests cover queue selection, direct links, invalid input, historical lookup, and missing-order feedback. Production build, typecheck, lint, formatting, and backlog checks run before the direct `main` push.
