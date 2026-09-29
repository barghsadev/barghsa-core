# Staff inbox in the admin workspace

Task context: `05-notifications-documents-ai.md#T-05.02.03` (staff context extension).

The admin shell now has a notification bell and inbox navigation. Its full inbox reuses the customer notification center, but opens in the staff workspace and follows only staff links. Account-security notices remain visible to staff; customer-only links explain that the user must switch to customer mode to see details. The customer bell likewise avoids opening staff routes. Existing read actions and counts use the context-scoped API.

Validation: web and i18n build/typecheck; notification unit tests; bilingual staff inbox Playwright journey across all five browser projects; lint and format; kanban backlog validation. The Playwright journey covers staff notices, account-security notices, context switching, and denial of the staff route in customer mode.
