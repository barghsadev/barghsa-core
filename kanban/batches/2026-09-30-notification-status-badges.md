# Notification category badges

Canonical work: `07-ui-ux-design.md#T-07.27.01.05` (`NotificationStatusBadge`).

The shared notification row used by the customer and staff bell and full inbox now includes a visible category badge with an icon, color and localized label for security, payment, contract, order, document and system notices. The existing unread marker and item actions remain intact. Document events, which the backend already emits, now map to their own category in Persian and English instead of appearing as System.

Validation: notification category and badge unit tests, bilingual notification-center Chromium flows, full web and i18n tests, root build/typecheck/lint/format, route budgets and generated backlog check.
