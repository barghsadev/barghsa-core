# Saving order history pagination — September 23, 2026

Canonical scope: the complete profile-scoped saving order list in `03-core-business.md#T-03.09.04.03`.

The customer saving-order API previously stopped after 100 orders. It now returns an older-page cursor using submission time and order ID, scoped to the authorized profile. The customer list loads additional pages without dropping earlier orders, and its next-action links navigate within the app so the selected language persists.

Validation: the real saving order HTTP test covers the cursor, invalid and unknown cursor handling; the Chromium saving journey loads a second page and retains both orders. API/web typechecks, web production build, i18n tests, contract check, targeted lint and formatting, and backlog validation passed locally. CI is pending after the direct `main` push.
