# Wallet balance breakdown on the dashboard

Canonical task: `07-ui-ux-design.md#T-07.26.01.02`.

The customer dashboard now shows available, posted and reserved wallet balances using exact decimal IRR strings. Reserved funds appear only when positive. The existing wallet action opens the charge page. Its low-balance warning now compares available funds with all currently unpaid invoices, including bills whose due date has not arrived, while retaining the active-profile and permission checks in the dashboard service.

Validation: dashboard service tests cover exact response values, profile-scoped outstanding invoice query and the warning condition; bilingual wallet-card tests cover all balance rows, the charge link and the zero-reservation case. Production build, raw typecheck, lint, formatting and backlog checks run before the direct `main` push. GitHub CI runs on the pushed commit.
