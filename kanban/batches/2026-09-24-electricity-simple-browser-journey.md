# Simple electricity customer browser journey

Canonical scope: the simple electricity portion of `03-core-business.md#T-03.90.14`.

A browser journey now starts in the electricity catalogue, selects a weekly simple order, enters a manual quantity when bill data is unavailable, and reviews the thermal plus mandatory green composition and total before submitting. It verifies the submitted quote digest and the customer-facing staff-review status. After the staff review transition, it follows the linked invoice, completes a real UI wallet-payment confirmation with the exact review hash, returns to the paid order, and opens contract tracking. The browser uses controlled API responses for order, invoice and review state; backend submission, review and payment transactions are covered by their own integration suites.

Validation: the journey passed in Chromium, Firefox, WebKit, mobile Chromium, and mobile Safari. A final Chromium rerun also passed after checking that the green line remains visible on order detail. Web TypeScript, changed-file lint and formatting, and canonical backlog validation pass. No product source was changed in this batch.
