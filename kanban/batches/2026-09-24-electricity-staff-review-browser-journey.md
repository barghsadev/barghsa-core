# Electricity staff review browser handoff

Canonical scope: the simple electricity portion of `03-core-business.md#T-03.90.14`, using the staff review screen from `03-core-business.md#T-03.07.02.05`.

The simple electricity browser journey now submits the customer's reviewed quote, opens that order in the staff review queue, checks the saved contract terms and mandatory green line, approves the exact contract version through the confirmation dialog, and resumes the customer journey through invoice payment and contract activation. This removes the test-only approval flag that previously skipped the staff UI. Browser API responses are controlled; backend permission and transaction behavior remain covered by their integration suites.

Validation: the complete journey passed in Chromium, Firefox, WebKit, mobile Chromium and mobile Safari. Web typecheck, changed-file ESLint and Prettier, and canonical backlog validation pass. The direct-`main` CI run is tracked on GitHub.
