# Customer history filter counts and reset

Canonical work: customer-list adoption of `07-ui-ux-design.md#T-07.18.02.05`, with the disclosure/count portion of `07-ui-ux-design.md#T-07.18.01.03`. Customer saving orders, solar requests, consultations, electricity orders, invoices and contracts now share a Filters button with a localized active-field badge. Clear all appears only when an applied filter is active and remains usable while the fields are collapsed. The broader drawer/popover, active chips, full list framework and staff-list adoption remain open; parent tasks are not marked wholly complete.

The count includes search, selected statuses, date range, invoice amount range and contract service where applicable. Multiple statuses count as one populated field; paired date or amount bounds also count as one field. Sort order and the existing Pending, Unpaid or Active view are retained separately. Each route clears its applicable filter fields in one navigation, so the API receives one reset request without an old cursor. Contract detail links and the consultation form remain intact, and Back restores the previous URL filters.

The shared ListFilterPanel keeps field drafts mounted when collapsed. Clear all remounts only the filter controls to cancel pending debounced search and discard unapplied number/date drafts, including when their applied values were already empty. It returns focus to the Filters button before removing Clear all. Bilingual labels, accessible expanded/control relationships and account-configured number formatting apply across the six lists.

Review checked atomic route updates, retained view/sort/detail parameters, active-field counting including a zero minimum, reset boundaries, cancellation of draft timers, consultation-form preservation, keyboard focus and mobile RTL layout. An initial overlapping dependency build invalidated test imports; the successful final checks used completed build output. One initial WebKit scenario navigated back to its initial page during editing; it passes in the final run.

Validation:

- `pnpm build` and `pnpm typecheck` pass.
- `pnpm --filter @barghsa/web test`: 1,161 passing. The final focused HistoryFilterPanel regression rerun passes after the focus correction.
- `pnpm --filter @barghsa/i18n test`: 53 passing.
- Customer history, invoice and contract browser flows cover all six lists in English/Persian. The final Chromium/WebKit run passes all 24 scenarios, including one-request reset, count, collapse, view/sort retention, Back restoration, focus and accessibility. The earlier Firefox, Android and iPhone runs pass their 36 scenarios before the focus-only correction.
- `pnpm lint`, `pnpm format:check`, `pnpm check:bundle` with all 64 budgets, diff whitespace and `python3 kanban/scripts/build_backlog.py --check` pass.

The preceding contract-history batch's remote CI completed successfully, including combined source coverage. Current batch CI runs after the direct main push. The scheduler remains paused; historical loop state and generated queue/ledger are unchanged.
