# Electricity invoice return to order — September 23, 2026

Canonical scope: the customer next-action path in `03-core-business.md#T-03.07.01.04`, invoice detail navigation around `04-invoices-wallet-contracts.md#T-04.1.05.04`, and browser coverage toward `03-core-business.md#T-03.90.14`.

The authorized invoice detail API now identifies its originating electricity order from the original invoice in a correction chain. A paid or corrected invoice links customers back to that order, where the commercial and financial statuses and published-contract action are visible. Invoice workflow return links use client-side navigation so switching between invoice and order preserves the selected language. Consultation returns use the same navigation behavior.

Validation: two real electricity HTTP lifecycle cases cover ordinary and replacement invoices through review, payment, and activation; 28 invoice service tests, 13 invoice page tests, 53 dictionary tests, and the paid-invoice Chromium route case passed. API and web typechecks, web production build, targeted lint and formatting, and backlog validation passed locally. The browser case uses controlled API responses for routing and language preservation. CI is pending after the direct `main` push.
