# Staff electricity contract preview

Canonical scope: `03-core-business.md#T-03.07.02.05` and the simple electricity portion of `03-core-business.md#T-03.90.14`.

Staff reviewing an electricity order now see the saved text template, its name and version, and the exact rendered terms beside the product and price facts before choosing approve, request changes or reject. Orders without a text template explain where to inspect the saved contract data. The existing expandable raw snapshot remains available for detailed review. The customer browser journey now models the database's approved-to-active order transition after contract activation, so it verifies Active/Paid on return to the order.

Validation: the staff order page tests cover a populated template and the no-template path (2 passed). The simple customer journey passed in Chromium, Firefox, WebKit, mobile Chromium and mobile Safari. All 53 i18n tests, web typecheck, changed-file ESLint and Prettier, and canonical backlog validation pass. The direct-`main` CI run is tracked on GitHub.
