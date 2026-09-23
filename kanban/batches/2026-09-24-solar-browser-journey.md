# Solar customer browser journey

Canonical scope: the solar portion of `03-core-business.md#T-03.90.14`.

One browser journey now exercises the customer path from a saved construction-request draft through submission, actual document-byte upload, document-set review submission, postal guidance, and shipment tracking. The test asserts the request and document association payloads and the visible completion states. It runs against controlled API responses; staff document approval is represented by the status returned on the customer's next visit. Existing API tests cover the backend transitions separately.

Validation: the focused journey passed in Chromium, Firefox, WebKit, mobile Chromium, and mobile Safari. Web TypeScript, changed-file ESLint and Prettier, and the canonical backlog check passed. No product behavior was changed in this batch.
