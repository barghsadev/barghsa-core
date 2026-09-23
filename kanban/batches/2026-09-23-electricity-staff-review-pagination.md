# Electricity staff review pagination — September 23, 2026

Canonical scope: staff electricity order review queue in `03-core-business.md#T-03.07.02.04`.

The staff queue previously stopped at its first 50 pending orders, leaving later orders unreachable. The API now returns an oldest-first keyset cursor and the dashboard loads additional pages without dropping earlier rows. Refresh and completed decisions start a fresh queue; loss of review permission clears previously loaded rows. A reviewed order can still serve as a cursor because its submission timestamp remains available.

Validation: a real HTTP test covers staff authorization, cursor validation, two-order paging and paging after an approval; a focused service test covers the 50-row boundary; the staff page test covers retaining both loaded pages. API and web typechecks, web production build, the admin dictionary test, contract check, targeted lint and formatting, and backlog validation passed locally. CI is pending after the direct `main` push.
