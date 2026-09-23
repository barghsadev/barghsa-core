# Consultation customer and staff continuity — September 23, 2026

Canonical scope: `03-core-business.md#T-03.03.02.03`–`.04` and `T-03.03.03.01`.

Customers can now load older profile-scoped consultation requests without losing the request form or earlier history. Accepting a fee offer opens its invoice within the app, as do the detail page's invoice and return links, preserving the selected language. Staff can page through work while keeping status, assignment, priority, and age filters; changing a filter resets the page and selection. The API contract marks those filters optional and documents the new cursors.

The real API cursor tests uncovered a precision fault: converting a PostgreSQL timestamp to a JavaScript `Date` before using it as a keyset boundary can round away microseconds and repeat the cursor row. Consultation, electricity, saving, and solar customer/staff cursor lookups now pass PostgreSQL's full-precision timestamp text back to PostgreSQL for comparison.

Validation: consultation customer/staff HTTP flows, focused electricity/saving/solar cursor flows, staff queue UI test, five Chromium customer-route cases, API/web typechecks and production builds, targeted lint and formatting, backlog validation, and a freshly generated OpenAPI comparison passed locally. CI is pending after the direct `main` push.
