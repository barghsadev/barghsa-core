# Saving customer route and browser journey — September 23, 2026

Canonical scope: customer access to `03-core-business.md#T-03.09.03.04`, `T-03.09.04.03`, and `T-03.09.04.04`; browser coverage toward `T-03.90.14`.

The saving catalogue and order-list pages had been used as parent routes without rendering their child outlets. Direct visits to `/savings/order` and `/savings/orders/:orderId` therefore showed a parent page instead of the wizard or order detail. The catalogue and order list are now index routes, with outlet-only parents. Catalogue links use client-side navigation so the selected language remains in place when starting an order.

A Chromium browser journey now covers catalogue → six-step order wizard → reviewed quote and submission → customer detail and fulfillment stages → order list → detail. It checks saved wizard steps and the submitted IDs/digest. The browser test uses controlled API responses; the saving-order HTTP integration suite remains the backend transaction evidence. Solar and full electricity payment/contract browser journeys remain outside this batch, so `T-03.90.14` is still partial. The Playwright local base URL now follows the Vite port (default 3000), allowing the test server to start correctly.

Validation: one Chromium journey (including two repeat passes), all 977 web tests, web typecheck and production build, targeted lint and formatting, and backlog validation passed locally. All four CI jobs passed in run `35910622879` after the direct `main` push.
