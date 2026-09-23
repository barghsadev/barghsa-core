# Solar invoice next action — September 24, 2026

Canonical scope: the customer handoff after solar contract and invoice creation in `03-core-business.md#T-03.13.01.02` and `.04`, using the shared next-action requirement in `03-core-business.md#T-03.90.16` and `.18`.

When staff create a solar contract, the authorized customer request list and detail now include the initial invoice ID and current payment state. An unpaid, partially funded, or overdue invoice appears as the customer's next action and links to that invoice. While payment is under review, the next action belongs to staff. After payment, the existing contract publication guidance returns; once published, the customer can open the contract.

The initial invoice already existed and contract creation was already atomic. This batch changes the information returned to the customer and the guidance shown on the list and detail pages. It adds no payment processor or contract transition.

Validation: migrated solar HTTP integration verifies invoice state on both authorized endpoints; focused next-action tests cover payment states and contract publication; the customer browser journey passes Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari. API, web, and i18n typechecks, API and web builds, targeted lint and format, OpenAPI contract, and backlog validation pass locally.
