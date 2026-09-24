# Staff electricity and contract invoice handoffs

Canonical scope: the staff side of the electricity order → payment → contract journey and invoice list/detail composition in `07-ui-ux-design.md#T-07.18.03.02`.

The invoice ledger accepts a validated invoice ID in its URL, immediately loads the matching list row and detail, and keeps a manual lookup available. Staff electricity order review, finalized price adjustments, expired quantity-increase cases, contract lists, and contract activation requirements now link to that exact invoice. Customer contract links continue to open the customer invoice page. A linked contract invoice remains navigable even when its amount is not available in the list response.

This changes navigation only. The ledger still enforces its own `invoices:read` permission, so a staff member without finance read access sees the permission message rather than invoice details.

Validation: 40 focused frontend tests across the ledger, electricity review, price adjustments, quantity increases, contracts and activation views. Production build, typecheck, lint, formatting and kanban checks run before the direct `main` push. GitHub CI runs on the pushed commit.
