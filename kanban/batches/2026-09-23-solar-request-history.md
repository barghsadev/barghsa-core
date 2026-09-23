# Solar request history and navigation — September 23, 2026

Canonical scope: customer access to solar requests under `03-core-business.md#T-03.11.03.03` and status/history visibility under `T-03.11.04.01`; contributes to the cross-workflow customer journey in `T-03.90.14`.

The solar request list previously stopped after 100 records. It now uses a profile-scoped older-request cursor, keeps earlier pages visible, and offers a retry after a failed fetch. Intake and detail links to addresses, request history, published contracts, and invoices navigate within the app, preserving the selected language.

This batch also repairs the OpenAPI snapshot drift introduced by the recent electricity and saving queue cursors. CI for `01c68199` failed only in monorepo integrity because its generated OpenAPI parameters were missing from the committed snapshot. The snapshot now includes those parameters and the new solar cursor; the saving cursor is explicitly documented as a UUID string.

Validation: the real solar HTTP flow checks ordering, cursor exclusion, malformed/unknown cursors, and profile isolation. Four Chromium customer-route cases pass, including older-page loading and language-preserving return. API/web typechecks and production builds, targeted lint and formatting, backlog validation, and a fresh generated OpenAPI comparison pass locally. CI is pending after the direct `main` push.
