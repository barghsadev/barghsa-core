# Advanced electricity payment and contract browser journey

Canonical scope: the advanced-order portion of `03-core-business.md#T-03.90.14` and the customer handoff across `T-03.06.04.05` and `T-03.07.04.03`.

The existing bilingual advanced-order browser journey now continues after submission. It verifies the full thermal, derived green, and free-market order breakdown; a staff-review handoff; the linked invoice's exact wallet-payment review hash and amount; the paid order's next action; and loading the selected published contract. The browser controls API responses for those states, while backend submission, review, and payment transactions remain in their integration suites. A shared electricity payment fixture keeps the simple and advanced browser journeys consistent.

Validation: the advanced journey passes in English and Persian across Chromium, Firefox, WebKit, mobile Chromium, and mobile Safari (10 cases). The related simple-order journey and language-navigation case passed across those five projects before the final contract-fixture adjustment; the final adjustment was confined to the advanced test. Web typecheck, changed-file lint and formatting, and backlog validation pass. No product source changed in this batch.
