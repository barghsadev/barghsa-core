# Solar customer browser journey

Canonical scope: the solar portion of `03-core-business.md#T-03.90.14`.

One browser journey exercises the customer path from a saved construction-request draft through submission, actual document-byte upload, document-set review submission, postal guidance, and shipment tracking. The same journey now visits the staff document queue to approve the uploaded file and advance the request, then visits the staff postal queue to confirm receipt. It returns to the customer detail after each handoff and checks the visible state. API responses are controlled by the fixture; existing API tests cover the backend transitions separately.

Validation: the full journey passed in Chromium, Firefox, WebKit, mobile Chromium, and mobile Safari. Web TypeScript, changed-file ESLint and Prettier, and the canonical backlog check passed. No product behavior was changed in this batch.
