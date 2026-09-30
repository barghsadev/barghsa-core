# Customer invoice history filters and pagination

Canonical work: invoice-list adoption of `07-ui-ux-design.md#T-07.18.02.01` and `.02`, the TextFilter and NumberFilter portions of `.03`, URL persistence from `.04`, sorting from `07-ui-ux-design.md#T-07.18.01.04`, and the invoice list portion of `07-ui-ux-design.md#T-07.18.03.02` / `04-invoices-wallet-contracts.md#T-04.1.05.04`. SelectFilter, MultiSelectFilter, the full list framework and adoption on other lists remain open; these parent tasks are not marked wholly complete.

Customers can search invoice references, select several invoice states, filter creation dates with localized calendar presets or custom dates, apply inclusive minimum/maximum total amounts in IRR, and sort by creation date in either direction. Controls compose with the existing Unpaid view. URL selections survive reload and Back/Forward; changed filters discard accumulated rows and cursors. The shared NumberFilter keeps draft edits local, blocks invalid or reversed ranges, restores navigation values and supports Clear. Amount validation normalizes Persian and Arabic digits and preserves exact integers through PostgreSQL int8, including values beyond JavaScript's safe integer range.

The invoice API now returns at most 50 rows and a nextBefore cursor. Both cursor lookup and row selection apply identical profile, non-draft, unpaid, status, creation-date, escaped literal search and amount constraints before pagination. Creation timestamp plus UUID order is deterministic in either direction; cursor timestamps preserve PostgreSQL microseconds. Draft, foreign, unknown and filter-mismatched cursors resolve to the same not-found outcome. Existing session, membership and permission rechecks remain in the authorized transaction, and credit adjustments stay excluded from the Unpaid view. The customer page loads lazily, cancels stale requests, supports load-more and retry, and preserves correction explanations, service periods, payment totals, due dates and invoice links.

Review checked bound parameters, enum comparisons, hardcoded sort directions, cursor/row predicate consistency, exact amount handling, route normalization, stale-response cancellation, profile-change remounting, labeled controls and mobile RTL layout. PostgreSQL tests caught and corrected an enum-to-text comparison error before shipping. A broader invoice browser run exposed an older admin due-period fixture that lacked authenticated staff context and stored locale; both fixtures were repaired without changing admin production behavior.

Validation:

- Invoice controller, details service and PostgreSQL HTTP tests: 55 passing. Real database coverage includes more than two pages in both directions, tied and microsecond timestamps, filtering before the page bound, adjacent large integer amounts, literal wildcard search, invalid filters and private cursors.
- Shared status/date/search/invoice-query tests: 39 passing.
- Full web unit suite: 1,160 passing; translation suite: 53 passing.
- New invoice filter browser flows: 10 passing across English/Persian and Chromium, Firefox, WebKit, Android and iPhone. Existing wallet-payment/correction journeys: 22 passing in Chromium. Repaired admin due-period scenarios: four passing, including accessibility checks.
- Root build, typecheck, lint, formatting, OpenAPI consistency, all 64 route/interaction budgets, diff whitespace and generated backlog validation pass.

The preceding electricity-history batch's GitHub CI completed successfully. Current batch CI runs after the direct main push. The scheduler remains paused; historical loop state and generated queue/ledger are unchanged.
