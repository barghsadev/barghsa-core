# Electricity journey navigation — September 23, 2026

Canonical scope: no-dead-end customer order guidance in `03-core-business.md#T-03.07.04.03`, customer order list/detail navigation in `03-core-business.md#T-03.07.04.01` and `.02`, and lifecycle browser coverage toward `03-core-business.md#T-03.90.14`.

Electricity order list, detail, invoice and contract links now navigate within the app. The shared workflow banner also uses client-side navigation for route actions and support links while retaining native same-page anchors for correction forms. Customers can follow order → invoice → order → published contract without losing their selected language.

Validation: 32 related component/page tests and the Chromium order → invoice → contract route test passed. Web typecheck, production build, targeted lint and formatting, and backlog validation passed locally. The browser test uses controlled API responses and verifies routing and locale persistence; it does not repeat the real HTTP lifecycle tests from the preceding invoice batch. CI is pending after the direct `main` push.
