# Consultation offer and invoice handoff

Canonical scope: `03-core-business.md#T-03.03.02.03`, `03-core-business.md#T-03.03.02.04`, `03-core-business.md#T-03.03.03.01`, and `03-core-business.md#T-03.03.03.03`.

The customer consultation list now links an accepted, unpaid offer directly to its invoice. The request card still opens the consultation detail. A browser journey covers product selection and submission, staff review and fee offer, customer acceptance and invoice navigation, the pending-payment return path, and staff completion after confirmed payment. It uses controlled API responses; the existing consultation API integration tests cover the transitions and finance settlement separately.

Validation: the journey passed in Chromium, Firefox, WebKit, mobile Chromium, and mobile Safari. Three consultation API integration suites (8 tests), web TypeScript, changed-file ESLint and Prettier, and the canonical backlog check passed.
