# Customer contract history filters

Canonical work: contract-list adoption of `07-ui-ux-design.md#T-07.18.02.01` and `.02`, the TextFilter and SelectFilter portions of `.03`, URL persistence from `.04`, sorting from `07-ui-ux-design.md#T-07.18.01.04`, and the customer-list portion of `07-ui-ux-design.md#T-07.18.03.01`. MultiSelectFilter, the full list framework, staff-list filter adoption and broader domain patterns remain open; these parent tasks are not marked wholly complete.

Customers can search contract numbers and references, select several customer-visible states, choose a service through a searchable dropdown, filter publication dates with localized calendar presets or custom dates, and sort newest/oldest publication first. Controls compose with the existing Active view. URL selections survive reload and Back/Forward; changes clear accumulated pages and cursors while keeping contract detail available. A reusable labeled SelectFilter uses the existing combobox, supports an All option, and shows a translated no-match message.

The API keeps its 100-row page bound and applies identical active-profile, publication, state, service, date and escaped literal search constraints to cursor lookup and row selection. Publication timestamp plus UUID order is deterministic in either direction, including tied timestamps; cursor lookup preserves PostgreSQL microseconds. Foreign, unpublished, unknown and filter-mismatched cursors return the same not-found outcome. Existing authorization and membership rechecks remain in the authorized transaction. Acceptance, signature uploads and evidence, activation prerequisites, linked orders and invoices remain available.

Review checked bound parameters, enum comparisons, hardcoded sort directions, cursor/row predicate consistency, route normalization, cancellation of stale requests, profile-change remounting, selected-detail preservation and labeled mobile RTL controls. Real PostgreSQL tests caught an enum-to-text comparison error before shipping. Existing contract browser fixtures lacked authenticated route context and stored locale; those fixtures were updated, and the authoring fixture's branding payload now supplies required identity/contact fields so its dark-mode accessibility checks execute.

Validation:

- Contract review, authoring and activation PostgreSQL HTTP suites: 71 passing. Coverage includes pagination beyond 100 rows in both directions, tied timestamps, filtering before the page limit, literal wildcard/injection-shaped search, invalid input and inaccessible cursors.
- Shared contract-query, status, date and search tests: 35 passing.
- Full web unit suite: 1,160 passing; translation suite: 53 passing.
- English/Persian contract history and authoring browser scenarios: 20 passing across Chromium, Firefox, WebKit, Android and iPhone, including accessibility checks. Existing publishing, acceptance/upload, signature and activation journeys: 12 passing in Chromium.
- Root build, typecheck, lint, formatting, OpenAPI consistency, all 64 route/interaction budgets, diff whitespace and generated backlog validation pass.

The preceding invoice-history batch's GitHub CI completed successfully. Current batch CI runs after the direct main push. The scheduler remains paused; historical loop state and generated queue/ledger are unchanged.
