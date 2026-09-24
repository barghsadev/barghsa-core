# Electricity order to active contract browser journey

Canonical scope: the simple electricity portion of `03-core-business.md#T-03.90.14`.

The customer browser journey now continues from the paid invoice into the published contract. It checks the activation prerequisites, reviews and accepts the exact contract version, verifies the acceptance review hash, and returns to the order to see its payment and contract status together. The order detail now shows its linked contract state in Persian and English. The browser controls API responses for staff approval, payment and activation; those transactions have separate backend integration coverage. The next staff-review batch corrected the browser mock so the order itself also becomes Active after activation.

The previous CI run failed because a dashboard integration assertion expected a future-due Unpaid invoice to be excluded from the low-balance warning. The service and its unit contract include all unpaid invoices, so the integration assertion now matches that behavior.

Validation: the browser journey passed in Chromium, Firefox, WebKit, mobile Chromium and mobile Safari. The focused dashboard/profile API tests passed (17), as did the electricity order-detail tests (10), web typecheck, changed-file ESLint and Prettier, and canonical backlog validation. The new direct-`main` CI run is tracked on GitHub.
