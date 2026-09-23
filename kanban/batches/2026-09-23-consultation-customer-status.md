# Consultation customer status and ownership — September 23, 2026

Canonical scope: customer ownership and next-action criteria in `03-core-business.md#T-03.03.02.03` and `T-03.03.02.04`.

The customer consultation list and detail now show the assigned staff username or team. The list receives current offer, invoice, acceptance, and pending-refund facts from the authorized API, then uses the same bilingual next-action logic as the detail page. Customers can distinguish staff review, an information request, an offer awaiting their decision, payment, receipt review, and financial closure without opening every request. The detail page retains its existing status banner and actions.

Validation: three consultation HTTP integration cases, three Chromium customer-route cases, all 977 web tests, API and web typechecks, web production build, targeted lint and formatting, and backlog validation passed locally. CI is pending after the direct `main` push.
