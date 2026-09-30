# Customer dashboard recent orders

Canonical work: `07-ui-ux-design.md#T-07.19.02.05` (`LatestOrdersWidget`).

The active-profile dashboard now combines the five newest electricity and saving orders by submission time, with localized status, account-timezone date, amount, and a direct customer detail link. Electricity rows use the same contract and initial-invoice joins as their customer detail route, so the widget does not advertise a link to an unavailable detail. Saving rows use the saving-order detail route and show an unavailable-amount label until an automatic invoice exists. Customers can open either order list from the widget. Agents without order-read permission receive no recent-order data. The existing profile-revision guard prevents old-profile rows appearing after a switch, and both dashboard widgets share one timezone read.

Legacy order rows and solar requests are outside this widget because this customer dashboard has no matching legacy or solar order-detail route yet.

Validation: PostgreSQL-backed dashboard HTTP integration, dashboard service tests, Chromium dashboard flow, i18n tests, root build/typecheck/lint/format, OpenAPI contract, bundle budgets, and generated backlog check. The active-contract widget remains open.
